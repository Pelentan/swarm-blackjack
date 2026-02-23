FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
EXPOSE 3008
CMD ["gunicorn", "--bind", "0.0.0.0:3008", "--workers", "1", "main:app"]
