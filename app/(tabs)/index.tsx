import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useState, useRef } from 'react';
import {
    Button,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    Image,
    Alert,
    ActivityIndicator,
    Pressable
} from 'react-native';

export default function App() {
    // --- STATE ---
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);
    const [picture, setPicture] = useState<string | null>(null);
    const [boxes, setBoxes] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // 🆕 NEW: Track which hold is selected (null = none)
    const [selectedBoxIndex, setSelectedBoxIndex] = useState<number | null>(null);

    // --- PERMISSIONS ---
    if (!permission) return <View />;
    if (!permission.granted) {
        return (
            <View style={styles.container}>
                <Text style={{color:'white', textAlign:'center', marginBottom: 20}}>
                    We need camera access to see the wall!
                </Text>
                <Button onPress={requestPermission} title="Grant Permission" />
            </View>
        );
    }

    // --- ACTIONS ---
    async function takePicture() {
        if (cameraRef.current) {
            setLoading(true);
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
            setPicture(photo.uri);
            detectHolds(photo.uri);
        }
    }

    async function pickImage() {
        let result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 1,
        });

        if (!result.canceled) {
            setLoading(true);
            const uri = result.assets[0].uri;
            setPicture(uri);
            detectHolds(uri);
        }
    }

    async function detectHolds(imageUri: string) {
        const formData = new FormData();
        formData.append('image', {
            uri: imageUri,
            name: 'climb.jpg',
            type: 'image/jpeg',
        } as any);

        try {
            // ⚠️ KEEP YOUR IP ADDRESS HERE!
            const SERVER_URL = 'http://192.168.5.209:5000/detect';

            const response = await fetch(SERVER_URL, {
                method: 'POST',
                body: formData,
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            const data = await response.json();
            setBoxes(data);
            setLoading(false);

        } catch (error) {
            console.error(error);
            Alert.alert("Error", "Could not reach server.");
            setLoading(false);
        }
    }

    // --- RENDER ---

    // MODE 1: RESULT SCREEN
    if (picture) {
        return (
            <View style={styles.container}>

                {/* CLICK BACKGROUND TO DESELECT EVERYTHING */}
                <Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedBoxIndex(null)}>
                    <Image source={{ uri: picture }} style={styles.fullscreenImage} resizeMode="stretch" />
                </Pressable>

                {loading && (
                    <View style={styles.loaderOverlay}>
                        <ActivityIndicator size="large" color="#00FF00" />
                        <Text style={{color: 'white', marginTop: 10}}>Scanning wall...</Text>
                    </View>
                )}

                {/* DRAW THE BOXES */}
                {!loading && boxes.map((box, index) => {

                    // CHECK IF THIS BOX IS THE "CHOSEN ONE"
                    const isSelected = selectedBoxIndex === index;

                    return (
                        <TouchableOpacity
                            key={index}
                            activeOpacity={0.8}
                            onPress={() => setSelectedBoxIndex(index)} // Select this box
                            style={[
                                styles.box,
                                {
                                    left: `${box.x}%`,
                                    top: `${box.y}%`,
                                    width: `${box.w}%`,
                                    height: `${box.h}%`,
                                    // IF SELECTED: Bright Green Border. IF NOT: Faint White Border.
                                    borderColor: isSelected ? '#00FF00' : 'rgba(255, 255, 255, 0.3)',
                                    borderWidth: isSelected ? 3 : 1,
                                    zIndex: isSelected ? 20 : 10,
                                }
                            ]}
                        >
                            {/* ONLY SHOW LABEL IF SELECTED */}
                            {isSelected && (
                                <View style={styles.infoBubble}>
                                    <Text style={styles.infoTitle}>{box.label}</Text>
                                    <Text style={styles.infoDesc}>{box.technique}</Text>
                                </View>
                            )}
                        </TouchableOpacity>
                    );
                })}

                <View style={styles.footer}>
                    <Button title="Retake" onPress={() => { setPicture(null); setBoxes([]); setSelectedBoxIndex(null); }} />
                </View>
            </View>
        );
    }

    // MODE 2: CAMERA SCREEN
    return (
        <View style={styles.container}>
            <CameraView ref={cameraRef} style={styles.camera} facing="back" />
            <View style={styles.controlsContainer}>
                <TouchableOpacity style={styles.secondaryBtn} onPress={pickImage}>
                    <Text style={styles.btnText}>Upload</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.shutterBtn} onPress={takePicture}>
                    <View style={styles.shutterInner} />
                </TouchableOpacity>
                <View style={styles.secondaryBtn} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: 'black', justifyContent: 'center' },
    fullscreenImage: { ...StyleSheet.absoluteFillObject, backgroundColor: 'black' },
    camera: { flex: 1 },

    box: {
        position: 'absolute',
        backgroundColor: 'transparent',
    },

    // THE POPUP BUBBLE
    infoBubble: {
        position: 'absolute',
        bottom: '100%', // Sit on top of the box
        left: -10, // Center slightly
        backgroundColor: 'rgba(0,0,0,0.8)',
        padding: 8,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: '#00FF00',
        minWidth: 120,
        marginBottom: 5,
    },
    infoTitle: { color: '#00FF00', fontWeight: 'bold', fontSize: 14, marginBottom: 2 },
    infoDesc: { color: 'white', fontSize: 12 },

    loaderOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', zIndex: 50 },

    controlsContainer: { position: 'absolute', bottom: 50, width: '100%', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
    shutterBtn: { width: 70, height: 70, borderRadius: 35, borderWidth: 4, borderColor: 'white', justifyContent: 'center', alignItems: 'center', backgroundColor: 'transparent' },
    shutterInner: { width: 55, height: 55, borderRadius: 30, backgroundColor: 'white' },
    secondaryBtn: { padding: 12, backgroundColor: 'rgba(50,50,50,0.8)', borderRadius: 8, minWidth: 80, alignItems: 'center' },
    btnText: { color: 'white', fontWeight: 'bold' },
    footer: { position: 'absolute', bottom: 40, width: '100%', alignItems: 'center' }
});