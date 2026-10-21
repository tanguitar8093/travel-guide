FROM node:22-alpine
RUN apk add --no-cache python3
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.py routing.py search.py sp2.py maps_urls.py ./
COPY public ./public
ENV PORT=3000 HOST=0.0.0.0
EXPOSE 3000
USER node
CMD ["python3", "server.py"]
