import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { BlurView } from 'expo-blur';
import MaskedView from '@react-native-masked-view/masked-view';
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg';
import Constants from 'expo-constants';
import { useState, useRef, useEffect } from 'react';
import { Button, StyleSheet, Text, TouchableOpacity, View, Image, Alert, ActivityIndicator, Dimensions, Animated, LayoutAnimation, Platform, UIManager, PanResponder, Pressable } from 'react-native';

const HOLD_TYPES = ["Jug", "Crimp", "Pinch", "Sloper", "Pocket", "Volume"];
const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
}

const HOLD_WEIGHTS: Record<string, number> = {
    "Jug": 1.0, "Volume": 2.0, "Pinch": 3.5, "Sloper": 5.0, "Crimp": 6.0, "Pocket": 7.0, "hold": 3.0
};

export default function App() {
    const [permission, requestPermission] = useCameraPermissions();
    const cameraRef = useRef<CameraView>(null);
    const [picture, setPicture] = useState<string | null>(null);
    const [boxes, setBoxes] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    const [step, setStep] = useState<'START' | 'TOP' | 'ROUTE' | 'EDIT' | 'SUMMARY'>('START');
    const [startHolds, setStartHolds] = useState<{index: number, clicks: number}[]>([]);
    const [topHold, setTopHold] = useState<number | null>(null);
    const [pathHolds, setPathHolds] = useState<number[]>([]);
    const [editingHoldIndex, setEditingHoldIndex] = useState<number | null>(null);

    const [routeStats, setRouteStats] = useState({ grade: "V?", moves: 0, holds: 0 });

    const popoverOpacity = useRef(new Animated.Value(0)).current;
    const popoverScale = useRef(new Animated.Value(0.95)).current;

    // --- STRICT BOTTOM SHEET MATH ---
    const summaryTranslateY = useRef(new Animated.Value(SCREEN_HEIGHT)).current;
    const lastCardY = useRef(0);
    const SHEET_HEIGHT = 340;
    const HEADER_HEIGHT = 65;
    const SHEET_OFFSET = SHEET_HEIGHT - HEADER_HEIGHT;

    const summaryPan = useRef(
        PanResponder.create({
            // Capture the touch immediately so we can detect both taps and drags
            onStartShouldSetPanResponder: () => true,
            onMoveShouldSetPanResponder: () => true,
            onPanResponderGrant: () => {
                summaryTranslateY.setOffset(lastCardY.current);
                summaryTranslateY.setValue(0);
            },
            onPanResponderMove: (_, gestureState) => {
                const newY = lastCardY.current + gestureState.dy;
                if (newY >= -10 && newY <= SHEET_OFFSET + 20) {
                    summaryTranslateY.setValue(gestureState.dy);
                }
            },
            onPanResponderRelease: (_, gestureState) => {
                summaryTranslateY.flattenOffset();
                const currentY = (summaryTranslateY as any)._value;

                // TAP DETECTION: If movement is less than 5 pixels, treat it as a tap
                if (Math.abs(gestureState.dx) < 5 && Math.abs(gestureState.dy) < 5) {
                    const isMinimized = lastCardY.current === SHEET_OFFSET;
                    const targetY = isMinimized ? 0 : SHEET_OFFSET;
                    Animated.spring(summaryTranslateY, { toValue: targetY, bounciness: 6, useNativeDriver: true }).start();
                    lastCardY.current = targetY;
                    return;
                }

                // DRAG / SWIPE DETECTION
                if (gestureState.dy > 40 || gestureState.vy > 0.5) {
                    Animated.spring(summaryTranslateY, { toValue: SHEET_OFFSET, bounciness: 6, useNativeDriver: true }).start();
                    lastCardY.current = SHEET_OFFSET;
                } else if (gestureState.dy < -40 || gestureState.vy < -0.5) {
                    Animated.spring(summaryTranslateY, { toValue: 0, bounciness: 6, useNativeDriver: true }).start();
                    lastCardY.current = 0;
                } else {
                    const snapY = currentY > (SHEET_OFFSET / 2) ? SHEET_OFFSET : 0;
                    Animated.spring(summaryTranslateY, { toValue: snapY, bounciness: 6, useNativeDriver: true }).start();
                    lastCardY.current = snapY;
                }
            }
        })
    ).current;

    useEffect(() => {
        if (step === 'SUMMARY') {
            summaryTranslateY.setValue(SCREEN_HEIGHT);
            Animated.spring(summaryTranslateY, { toValue: 0, bounciness: 5, useNativeDriver: true }).start(() => {
                lastCardY.current = 0;
            });
        }
    }, [step]);

    useEffect(() => {
        if (editingHoldIndex !== null) {
            Animated.parallel([
                Animated.timing(popoverOpacity, { toValue: 1, duration: 150, useNativeDriver: true }),
                Animated.spring(popoverScale, { toValue: 1, friction: 6, useNativeDriver: true })
            ]).start();
        }
    }, [editingHoldIndex]);

    function closeEditMenu() {
        Animated.parallel([
            Animated.timing(popoverOpacity, { toValue: 0, duration: 100, useNativeDriver: true }),
            Animated.timing(popoverScale, { toValue: 0.95, duration: 100, useNativeDriver: true })
        ]).start(() => setEditingHoldIndex(null));
    }

    if (!permission) return <View />;
    if (!permission.granted) {
        return (
            <View style={styles.container}>
                <Text style={{color:'white', textAlign:'center', marginBottom: 20}}>We need camera access!</Text>
                <Button onPress={requestPermission} title="Grant Permission" />
            </View>
        );
    }

    async function takePicture() {
        if (cameraRef.current) {
            setLoading(true);
            const photo = await cameraRef.current.takePictureAsync({ quality: 0.5 });
            setPicture(photo.uri);
            detectHolds(photo.uri);
        }
    }

    async function pickImage() {
        let result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
        if (!result.canceled) {
            setLoading(true);
            const uri = result.assets[0].uri;
            setPicture(uri);
            detectHolds(uri);
        }
    }

    async function detectHolds(imageUri: string) {
        const formData = new FormData();
        formData.append('image', { uri: imageUri, name: 'climb.jpg', type: 'image/jpeg' } as any);
        try {
            const SERVER_URL = "https://alene-cloque-unperceivably.ngrok-free.dev/detect";
            const response = await fetch(SERVER_URL, { method: 'POST', body: formData, headers: { 'Content-Type': 'multipart/form-data' } });
            const data = await response.json();
            if (!response.ok) { Alert.alert("Error", data.error); setLoading(false); return; }
            setBoxes(data.holds || []);
            softReset();
        } catch (error) { Alert.alert("Error", "Could not reach server."); setLoading(false); }
    }

    function hardReset() {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        setPicture(null);
        setBoxes([]);
        softReset();
    }

    function softReset() {
        setStep('START'); setStartHolds([]); setTopHold(null); setPathHolds([]);
        setEditingHoldIndex(null); setLoading(false);
    }

    function handleHoldClick(index: number) {
        if (step === 'START') {
            const existing = startHolds.find(h => h.index === index);
            if (existing) {
                if (existing.clicks === 1) setStartHolds(startHolds.map(h => h.index === index ? { ...h, clicks: 2 } : h));
                else setStartHolds(startHolds.filter(h => h.index !== index));
            } else {
                if (startHolds.length < 2) setStartHolds([...startHolds, { index, clicks: 1 }]);
                else Alert.alert("Limit Reached", "Max 2 starting holds.");
            }
        }
        else if (step === 'TOP') {
            if (topHold === index) setTopHold(null); else setTopHold(index);
        }
        else if (step === 'ROUTE') {
            if (pathHolds.includes(index)) setPathHolds(pathHolds.filter(i => i !== index));
            else setPathHolds([...pathHolds, index]);
        }
        else if (step === 'EDIT' || step === 'SUMMARY') {
            const isSelected = startHolds.some(h => h.index === index) || topHold === index || pathHolds.includes(index);
            if (isSelected) setEditingHoldIndex(index);
        }
    }

    function changeHoldType(newType: string) {
        if (editingHoldIndex === null) return;
        const updatedBoxes = [...boxes];
        updatedBoxes[editingHoldIndex].label = newType;
        setBoxes(updatedBoxes);
        closeEditMenu();
        if (step === 'SUMMARY') updateRouteStats(updatedBoxes);
    }

    function calculateVGrade(sequence: number[][], currentBoxes: any[]) {
        if (!sequence || sequence.length < 2) return { grade: "V0", moves: 0 };
        let totalScore = 0; let moveCount = 0;

        for (let i = 1; i < sequence.length; i++) {
            const prevMove = sequence[i-1]; const currMove = sequence[i];
            let px = 0, py = 0;
            prevMove.forEach(idx => { px += currentBoxes[idx].x + currentBoxes[idx].w/2; py += currentBoxes[idx].y + currentBoxes[idx].h/2; });
            px /= prevMove.length; py /= prevMove.length;

            let cx = 0, cy = 0, maxHoldWeight = 0;
            currMove.forEach(idx => {
                cx += currentBoxes[idx].x + currentBoxes[idx].w/2; cy += currentBoxes[idx].y + currentBoxes[idx].h/2;
                maxHoldWeight = Math.max(maxHoldWeight, HOLD_WEIGHTS[currentBoxes[idx].label] || 3.0);
            });
            cx /= currMove.length; cy /= currMove.length;

            const dist = Math.sqrt(Math.pow(cx - px, 2) + Math.pow(cy - py, 2));
            const distanceMultiplier = Math.max(1.0, dist / 12);
            totalScore += (maxHoldWeight * distanceMultiplier);
            moveCount++;
        }

        const avgMoveScore = totalScore / moveCount;
        let finalGrade = "V8+";
        if (avgMoveScore < 1.8) finalGrade = "V0"; else if (avgMoveScore < 2.5) finalGrade = "V1";
        else if (avgMoveScore < 3.5) finalGrade = "V2"; else if (avgMoveScore < 4.8) finalGrade = "V3";
        else if (avgMoveScore < 6.2) finalGrade = "V4"; else if (avgMoveScore < 7.5) finalGrade = "V5";
        else if (avgMoveScore < 9.0) finalGrade = "V6"; else if (avgMoveScore < 11.0) finalGrade = "V7";

        return { grade: finalGrade, moves: moveCount };
    }

    function updateRouteStats(currentBoxes: any[]) {
        const lowestStartY = Math.max(...startHolds.map(h => currentBoxes[h.index].y));
        const handPath = pathHolds.filter(idx => currentBoxes[idx].y <= lowestStartY + 2);
        const sortedHands = handPath.sort((a, b) => currentBoxes[b].y - currentBoxes[a].y);

        const sequence = [
            startHolds.map(h => h.index),
            ...sortedHands.map(h => [h]),
            [topHold as number]
        ];

        const stats = calculateVGrade(sequence, currentBoxes);
        const totalHolds = startHolds.length + sortedHands.length + 1;
        setRouteStats({ grade: stats.grade, moves: stats.moves, holds: totalHolds });
    }

    function goNextStep() {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);

        if (step === 'START') {
            if (startHolds.length === 0) return Alert.alert("Wait!", "Please select at least 1 starting hold.");
            setStep('TOP');
        } else if (step === 'TOP') {
            if (topHold === null) return Alert.alert("Wait!", "Please select a top hold.");
            setStep('ROUTE');
        } else if (step === 'ROUTE') {
            setStep('EDIT');
        } else if (step === 'EDIT') {
            updateRouteStats(boxes);
            setStep('SUMMARY');
        }
    }

    function goBackStep() {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        if (step === 'SUMMARY') setStep('EDIT');
        else if (step === 'EDIT') { closeEditMenu(); setStep('ROUTE'); }
        else if (step === 'ROUTE') setStep('TOP');
        else if (step === 'TOP') setStep('START');
    }

    let popoverStyle = {};
    if (editingHoldIndex !== null) {
        const box = boxes[editingHoldIndex];
        popoverStyle = { left: (SCREEN_WIDTH - 300) / 2, ...(box.y < 50 ? { top: `${box.y + box.h + 2}%` } : { bottom: `${100 - box.y + 2}%` }) };
    }

    let cx = 50, cy = 50, rx = 40, ry = 40;
    if (step === 'EDIT' || step === 'SUMMARY') {
        const selectedBoxes = boxes.filter((b, i) => startHolds.some(h => h.index === i) || topHold === i || pathHolds.includes(i));
        if (selectedBoxes.length > 0) {
            const minX = Math.min(...selectedBoxes.map(b => b.x));
            const minY = Math.min(...selectedBoxes.map(b => b.y));
            const maxX = Math.max(...selectedBoxes.map(b => b.x + b.w));
            const maxY = Math.max(...selectedBoxes.map(b => b.y + b.h));
            cx = minX + (maxX - minX) / 2;
            cy = minY + (maxY - minY) / 2;
            rx = ((maxX - minX) / 2) + 15;
            ry = ((maxY - minY) / 2) + 15;
        }
    }

    if (picture) {
        return (
            <View style={styles.container}>
                <View style={StyleSheet.absoluteFillObject}>

                    <Image source={{ uri: picture }} style={StyleSheet.absoluteFillObject} resizeMode="stretch" />

                    {(step === 'EDIT' || step === 'SUMMARY') && (
                        <MaskedView
                            style={StyleSheet.absoluteFillObject}
                            maskElement={
                                <Svg width="100%" height="100%">
                                    <Defs>
                                        <RadialGradient id="blurMask" cx={`${cx}%`} cy={`${cy}%`} rx={`${rx}%`} ry={`${ry}%`} fx={`${cx}%`} fy={`${cy}%`}>
                                            <Stop offset="30%" stopColor="black" stopOpacity="0" />
                                            <Stop offset="100%" stopColor="black" stopOpacity="1" />
                                        </RadialGradient>
                                    </Defs>
                                    <Rect x="0" y="0" width="100%" height="100%" fill="url(#blurMask)" />
                                </Svg>
                            }
                        >
                            <BlurView intensity={80} tint="light" style={StyleSheet.absoluteFillObject} />
                        </MaskedView>
                    )}

                    {!loading && boxes.map((box, index) => {
                        if (box.label === 'Volume') return null;

                        const startData = startHolds.find(h => h.index === index);
                        const isStart = !!startData;
                        const isTop = topHold === index;
                        const isPath = pathHolds.includes(index);
                        const isSelected = isStart || isTop || isPath;

                        if ((step === 'EDIT' || step === 'SUMMARY') && !isSelected) return null;

                        let borderColor = 'rgba(255,255,255,0.3)';
                        let tintColor = 'transparent';
                        let borderWidth = isSelected ? 3 : 1;
                        let labelColor = '#999';

                        if (isStart) {
                            borderColor = startData.clicks === 1 ? '#39FF14' : '#008000'; tintColor = startData.clicks === 1 ? 'rgba(57, 255, 20, 0.2)' : 'rgba(0, 128, 0, 0.4)'; labelColor = borderColor;
                        } else if (isTop) {
                            borderColor = '#FF003F'; tintColor = 'rgba(255, 0, 63, 0.2)'; labelColor = borderColor;
                        } else if (isPath) {
                            borderColor = '#FFE600'; tintColor = 'rgba(255, 230, 0, 0.2)'; labelColor = borderColor;
                        }

                        if (editingHoldIndex === index) {
                            borderColor = '#0A84FF';
                            borderWidth = 4;
                            tintColor = 'rgba(10, 132, 255, 0.25)';
                        }

                        return (
                            <TouchableOpacity key={index} activeOpacity={0.8} onPress={() => handleHoldClick(index)}
                                              style={[ styles.box, { left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%`, borderColor: borderColor, backgroundColor: tintColor, borderWidth: borderWidth, zIndex: isSelected ? 15 : 5 } ]}
                            >
                                {(step === 'EDIT' || step === 'SUMMARY') && isSelected && (
                                    <View style={[styles.miniTag, { borderColor: labelColor }]}>
                                        <Text style={styles.miniTagText}>{box.label.charAt(0)}</Text>
                                    </View>
                                )}
                            </TouchableOpacity>
                        );
                    })}

                    {loading && (
                        <View style={styles.loaderOverlay}>
                            <ActivityIndicator size="large" color="#0A84FF" />
                            <Text style={{color: 'white', marginTop: 12, fontWeight: '700', letterSpacing: 0.5}}>Processing Wall...</Text>
                        </View>
                    )}

                    {editingHoldIndex !== null && (
                        <View style={[StyleSheet.absoluteFillObject, { zIndex: 100 }]} pointerEvents="box-none">
                            <Pressable style={StyleSheet.absoluteFillObject} onPress={closeEditMenu} />

                            <Animated.View style={[styles.popoverMenu, popoverStyle, { opacity: popoverOpacity, transform: [{ scale: popoverScale }] }]} pointerEvents="box-none">
                                <View style={styles.gridContainer}>
                                    {HOLD_TYPES.map((type) => {
                                        const isCurrentAI = boxes[editingHoldIndex].label === type;
                                        return (
                                            <TouchableOpacity key={type} style={[styles.gridButton, isCurrentAI && styles.gridButtonActive]} onPress={() => changeHoldType(type)}>
                                                <Text style={[styles.gridButtonText, isCurrentAI && styles.gridButtonTextActive]}>{type}</Text>
                                            </TouchableOpacity>
                                        );
                                    })}
                                </View>
                            </Animated.View>
                        </View>
                    )}
                </View>

                <View style={styles.bottomOverlayContainer} pointerEvents="box-none">
                    {step === 'SUMMARY' ? (
                        <Animated.View style={[styles.summaryCard, { transform: [{ translateY: summaryTranslateY }] }]}>

                            <View {...summaryPan.panHandlers} style={styles.sheetHeader}>
                                <View style={styles.dragHandle} />

                                <Animated.Text style={[styles.summaryHeaderText, {
                                    position: 'absolute', top: 32,
                                    opacity: summaryTranslateY.interpolate({ inputRange: [0, SHEET_OFFSET], outputRange: [1, 0], extrapolate: 'clamp' })
                                }]}>
                                    Route Analysis
                                </Animated.Text>
                                <Animated.Text style={[styles.summaryHeaderText, {
                                    position: 'absolute', top: 32, color: '#0A84FF',
                                    opacity: summaryTranslateY.interpolate({ inputRange: [0, SHEET_OFFSET], outputRange: [0, 1], extrapolate: 'clamp' })
                                }]}>
                                    TAP OR PULL UP TO REVIEW
                                </Animated.Text>
                            </View>

                            <View style={styles.sheetContent}>
                                <Text style={styles.summaryTitle}>Climb Graded</Text>

                                <View style={styles.statsRow}>
                                    <View style={styles.statBox}>
                                        <Text style={styles.statValue}>{routeStats.grade}</Text>
                                        <Text style={styles.statLabel}>Grade</Text>
                                    </View>
                                    <View style={styles.statBox}>
                                        <Text style={styles.statValue}>{routeStats.moves}</Text>
                                        <Text style={styles.statLabel}>Moves</Text>
                                    </View>
                                    <View style={styles.statBox}>
                                        <Text style={styles.statValue}>{routeStats.holds}</Text>
                                        <Text style={styles.statLabel}>Holds</Text>
                                    </View>
                                </View>

                                <TouchableOpacity onPress={hardReset} style={styles.primaryActionBtn}>
                                    <Text style={styles.primaryActionBtnText}>Finish</Text>
                                </TouchableOpacity>
                            </View>

                        </Animated.View>
                    ) : (
                        <View style={styles.darkNavBar}>
                            <View style={styles.navCenter} pointerEvents="none">
                                <Text style={styles.navMainTitle}>
                                    {step === 'START' ? "Starts (1/4)" : step === 'TOP' ? "Top Hold (2/4)" : step === 'ROUTE' ? "Path (3/4)" : "Review (4/4)"}
                                </Text>
                            </View>

                            <TouchableOpacity onPress={step === 'START' ? hardReset : goBackStep} style={styles.navActionLeft}>
                                <Text style={styles.navSubText}>{step === 'START' ? "Cancel" : "Back"}</Text>
                            </TouchableOpacity>

                            <TouchableOpacity onPress={goNextStep} style={styles.nextButton}>
                                <Text style={styles.nextButtonText}>{step === 'EDIT' ? "Analyze" : "Next"}</Text>
                            </TouchableOpacity>
                        </View>
                    )}
                </View>
            </View>
        );
    }

    return (
        <View style={styles.container}>
            <CameraView ref={cameraRef} style={styles.camera} facing="back" />
            <View style={styles.controlsContainer}>
                <TouchableOpacity style={styles.camBtn} onPress={pickImage}><Text style={styles.camBtnText}>Upload</Text></TouchableOpacity>
                <TouchableOpacity style={styles.shutterBtn} onPress={takePicture}><View style={styles.shutterInner} /></TouchableOpacity>
                <View style={styles.camBtn} />
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: 'black' },
    camera: { flex: 1 },
    imageContainer: { flex: 1, position: 'relative', overflow: 'hidden' },
    box: { position: 'absolute', borderRadius: 6 },
    loaderOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center', zIndex: 50 },

    controlsContainer: { position: 'absolute', bottom: 50, width: '100%', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
    shutterBtn: { width: 70, height: 70, borderRadius: 35, borderWidth: 4, borderColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center' },
    shutterInner: { width: 55, height: 55, borderRadius: 30, backgroundColor: '#FFFFFF' },
    camBtn: { padding: 12, backgroundColor: 'rgba(28, 28, 30, 0.8)', borderRadius: 12, minWidth: 80, alignItems: 'center' },
    camBtnText: { color: '#FFFFFF', fontWeight: '700' },

    miniTag: { position: 'absolute', bottom: 4, right: 4, backgroundColor: '#1C1C1E', width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center' },
    miniTagText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },

    popoverMenu: { position: 'absolute', width: 300, backgroundColor: '#1C1C1E', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#2C2C2E', shadowColor: 'black', shadowOffset: {width:0, height: 10}, shadowOpacity: 0.5, shadowRadius: 20, elevation: 20 },
    gridContainer: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
    gridButton: { width: '31%', backgroundColor: '#2C2C2E', paddingVertical: 14, borderRadius: 10, marginBottom: 8, alignItems: 'center' },
    gridButtonActive: { backgroundColor: '#0A84FF' },
    gridButtonText: { color: '#8E8E93', fontSize: 15, fontWeight: '600' },
    gridButtonTextActive: { color: '#FFFFFF', fontWeight: '800' },

    bottomOverlayContainer: { position: 'absolute', bottom: 0, width: '100%', zIndex: 100 },

    darkNavBar: {
        backgroundColor: '#1C1C1E',
        paddingHorizontal: 20,
        paddingTop: 16,
        paddingBottom: 40,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderTopWidth: 1,
        borderTopColor: '#2C2C2E'
    },
    navCenter: { position: 'absolute', left: 0, right: 0, top: 16, bottom: 40, alignItems: 'center', justifyContent: 'center', zIndex: 0 },
    navActionLeft: { paddingVertical: 12, paddingRight: 20, zIndex: 10 },
    navMainTitle: { fontSize: 16, fontWeight: '700', color: '#FFFFFF' },
    navSubText: { fontSize: 16, color: '#0A84FF', fontWeight: '600' },

    nextButton: { backgroundColor: '#0A84FF', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 8, minWidth: 80, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
    nextButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

    summaryCard: { position: 'absolute', bottom: 0, width: '100%', height: 340, backgroundColor: '#000000', borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderTopColor: '#2C2C2E' },
    sheetHeader: { height: 65, width: '100%', alignItems: 'center', paddingTop: 10, backgroundColor: 'transparent' },
    sheetContent: { flex: 1, paddingHorizontal: 24, paddingBottom: 25 },

    dragHandle: { width: 36, height: 5, backgroundColor: '#3A3A3C', borderRadius: 2.5 },
    summaryHeaderText: { fontSize: 12, color: '#8E8E93', fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' },
    summaryTitle: { fontSize: 30, fontWeight: '800', color: '#FFFFFF', marginBottom: 24, textAlign: 'center' },

    statsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 32 },
    statBox: { flex: 1, backgroundColor: '#1C1C1E', paddingVertical: 20, borderRadius: 16, alignItems: 'center', marginHorizontal: 6 },
    statValue: { fontSize: 28, fontWeight: '800', color: '#FFFFFF', marginBottom: 4 },
    statLabel: { fontSize: 11, color: '#8E8E93', fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },

    primaryActionBtn: { backgroundColor: '#0A84FF', width: '100%', paddingVertical: 18, borderRadius: 14, alignItems: 'center' },
    primaryActionBtnText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' }
});