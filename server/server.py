import os
import uuid
import json
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
from ultralytics import YOLO
from pillow_heif import register_heif_opener

register_heif_opener()

app = Flask(__name__)
CORS(app)

model = YOLO('best.pt')

# --- CREATE DATASET FOLDERS ---
os.makedirs('dataset/images', exist_ok=True)
os.makedirs('dataset/holds_data', exist_ok=True)
os.makedirs('dataset/pose_data', exist_ok=True)

technique_guide = {
    "Jug": "Rest spot! Shake out your arms here.",
    "Crimp": "Keep hips tight to the wall. Open-hand grip if possible.",
    "Pinch": "Engage your thumb! Squeeze hard.",
    "Sloper": "Stay low! Keep your arms straight and rely on friction.",
    "Volume": "Trust your feet. Smear or palm press.",
    "Pocket": "Watch your tendons.",
    "hold": "Just go for it!"
}

@app.route('/detect', methods=['POST'])
def detect():
    if 'image' not in request.files:
        return jsonify({'error': 'No image sent'}), 400

    file = request.files['image']

    try:
        img = Image.open(file.stream)
        if img.mode != 'RGB':
            img = img.convert('RGB')
    except Exception as e:
        print(f"Image open error: {e}")
        return jsonify({'error': 'Invalid image file'}), 400

    results = model(img, conf=0.35)
    detected_objects = []

    width, height = img.size
    result = results[0]

    if len(result.boxes) == 0:
        return jsonify({"holds": []})

    hold_data = []
    total_area_for_avg = 0
    count_for_avg = 0

    for box in result.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        w_px = x2 - x1
        h_px = y2 - y1
        area = w_px * h_px

        class_id = int(box.cls[0])
        original_label = model.names[class_id]

        hold_data.append({
            "x1": x1, "y1": y1, "w_px": w_px, "h_px": h_px,
            "area": area, "original_label": original_label
        })

        if original_label != "Volume":
            total_area_for_avg += area
            count_for_avg += 1

    avg_area = total_area_for_avg / count_for_avg if count_for_avg > 0 else 0

    for hold in hold_data:
        original_label = hold["original_label"]
        final_label = original_label
        area_pct = (hold["area"] / (width * height)) * 100

        if original_label != "Volume":
            if final_label == "Pocket":
                final_label = "Crimp"
            if area_pct > 8.0 and final_label == "Crimp":
                final_label = "Sloper"
            if avg_area > 0 and hold["area"] < (avg_area * 0.35) and final_label == "Jug":
                final_label = "Crimp"

        display_label = f"AI: {original_label} ➔ Logic: {final_label}" if original_label != final_label else final_label
        tip = technique_guide.get(final_label, "Pull hard!")

        obj = {
            "id": str(len(detected_objects)),
            "x": (hold["x1"] / width) * 100,
            "y": (hold["y1"] / height) * 100,
            "w": (hold["w_px"] / width) * 100,
            "h": (hold["h_px"] / height) * 100,
            "label": final_label,
            "display_label": display_label,
            "technique": tip
        }
        detected_objects.append(obj)

    detected_objects.sort(key=lambda item: item['w'] * item['h'], reverse=True)
    return jsonify({"holds": detected_objects})


@app.route('/save', methods=['POST'])
def save_dataset():
    if 'image' not in request.files or 'data' not in request.form:
        return jsonify({'error': 'Missing image or data payload'}), 400

    try:
        image_file = request.files['image']
        payload_data = json.loads(request.form['data'])

        # Robust UUID so files NEVER overwrite each other
        climb_id = uuid.uuid4().hex[:12]

        image_path = f"dataset/images/climb_{climb_id}.jpg"
        image_file.save(image_path)

        holds_path = f"dataset/holds_data/climb_{climb_id}_holds.json"
        with open(holds_path, 'w') as f:
            json.dump(payload_data.get('corrected_holds', []), f, indent=4)

        pose_path = f"dataset/pose_data/climb_{climb_id}_pose.json"
        with open(pose_path, 'w') as f:
            json.dump(payload_data.get('beta_frames', []), f, indent=4)

        print(f"✅ Successfully saved dataset for Climb ID: {climb_id}")
        return jsonify({'success': True, 'climb_id': climb_id})

    except Exception as e:
        print(f"❌ Server Error during save: {e}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)