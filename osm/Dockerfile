FROM python:3.12-slim
WORKDIR /app/osm
COPY osm/ /app/osm/
COPY shared/geo/ /app/shared/geo/
ENV PORT=3000 HOST=0.0.0.0 PYTHONDONTWRITEBYTECODE=1
EXPOSE 3000
USER 1000:1000
CMD ["python3", "server.py"]
