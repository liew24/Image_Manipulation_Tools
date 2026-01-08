## 🚀 How to Run the Program

Follow the steps below to run both the backend and frontend of the project.

---

## 🔧 Backend Setup (Python + FastAPI)

1. Navigate to the backend directory:
   ```bash
   cd backend

2. Create a virtual environment using Python 3.12:
   ```bash
   py -3.12 -m venv venv

3. Activate the virtual environment:
   ```bash
   .\venv\Scripts\Activate.ps1

4. Verify your Python version (must be Python 3.12.x):
   ```bash
   python --version

5. Upgrade pip and install required libraries:
   ```bash
   python -m pip install --upgrade pip setuptools wheel
   pip install fastapi uvicorn pydantic numpy opencv-python

6. Verify NumPy and OpenCV installation:
   ```bash
   python -c "import numpy as np; import cv2; print('numpy', np.__version__); print('cv2', cv2.__version__)"

7. Start the backend server:
   ```bash
   uvicorn server:app --reload --host 127.0.0.1 --port 8000

8. Open the backend in your browser:
   http://127.0.0.1:8000

## 🌐 Frontend Setup (HTML + JavaScript)

Open the project in Visual Studio Code.

Right-click home.html and select “Open with Live Server”.

## ✅ Notes
Make sure the backend server is running before opening the frontend.

The venv folder should not be pushed to GitHub.

This project is tested and intended to run on Python 3.12.x.

## 📦 Tech Stack
Frontend: HTML, CSS, JavaScript

Backend: Python, FastAPI

Image Processing: OpenCV, NumPy

## 📄 License

This project is for educational purposes only.
