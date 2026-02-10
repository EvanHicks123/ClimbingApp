import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from ultralytics import YOLO
from PIL import Image

app = Flask(__name__)
CORS(app)

# 1. LOAD YOUR CUSTOM MODEL
# This now knows "Jug", "Crimp", "Volume", etc.
model = YOLO('best.pt')

# 2. DEFINE THE COACHING LOGIC
# Matches the classes you just trained: Jug, Crimp, Pinch, Slope, Pocket, Volume
technique_guide = {
    "Jug": "Rest spot! Shake out your arms here.",
    "Crimp": "Keep hips tight to the wall. Open-hand grip if possible.",
    "Pinch": "Engage your thumb! Squeeze hard.",
    "Slope": "Stay low! Keep your arms straight and rely on friction.",
    "Pocket": "Be careful with your tendons. Don't pull with just one finger.",
    "Volume": "Trust your feet. Smear or palm press.",
    "hold": "Just go for it!" # Fallback
}

@app.route('/detect', methods=['POST'])
def detect():
    if 'image' not in request.files:
        return jsonify({'error': 'No image sent'}), 400

    file = request.files['image']
    img = Image.open(file.stream)

    # Run AI
    results = model(img, conf=0.25)

    detected_objects = []
    width, height = img.size

    for result in results:
        for box in result.boxes:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            w = x2 - x1
            h = y2 - y1

            # GET THE CLASS NAME (e.g., "Crimp")
            class_id = int(box.cls[0])
            label_name = model.names[class_id]

            # GET THE ADVICE
            tip = technique_guide.get(label_name, "Pull hard!")

            obj = {
                "id": str(len(detected_objects)),
                "x": (x1 / width) * 100,
                "y": (y1 / height) * 100,
                "w": (w / width) * 100,
                "h": (h / height) * 100,
                "label": label_name,
                "technique": tip     # <--- Sending this to the phone!
            }
            detected_objects.append(obj)

    print(f"🎉 Found {len(detected_objects)} holds!")
    return jsonify(detected_objects)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)