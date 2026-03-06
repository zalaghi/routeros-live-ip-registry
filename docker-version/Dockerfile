# syntax=docker/dockerfile:1
FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

ENV PORT=8080 \
    DATA_DIR=/data \
    DEVICES_DIR=/data/devices \
    TRUST_PROXY=0 \
    REQUIRE_TOKEN=1

VOLUME ["/data"]
EXPOSE 8080

CMD ["npm", "start"]
