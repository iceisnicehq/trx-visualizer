FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY public ./public
COPY worker ./worker
COPY scripts ./scripts
RUN mkdir -p /data && chown node:node /data
USER node
ENV PORT=8090 FLOW_LISTEN_HOST=0.0.0.0 FLOW_DATA_DIR=/data
EXPOSE 8090
CMD ["node", "scripts/serve.mjs"]
