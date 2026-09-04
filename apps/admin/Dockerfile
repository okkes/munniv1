# Admin console: standalone SPA in its own container (nginx)
FROM node:24-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/admin/package.json apps/admin/
RUN npm ci --workspace @munni/admin
COPY apps/admin apps/admin
ARG VITE_API_URL=""
ARG VITE_LOGTO_ENDPOINT=""
ARG VITE_LOGTO_APP_ID=""
ARG VITE_LOGTO_RESOURCE=""
ARG VITE_GLITCHTIP_DSN=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_LOGTO_ENDPOINT=$VITE_LOGTO_ENDPOINT \
    VITE_LOGTO_APP_ID=$VITE_LOGTO_APP_ID \
    VITE_LOGTO_RESOURCE=$VITE_LOGTO_RESOURCE \
    VITE_GLITCHTIP_DSN=$VITE_GLITCHTIP_DSN
RUN npm run build --workspace @munni/admin

FROM nginx:alpine
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
# runtime-config overlay: renders /runtime-config.js from MUNNI_* env at
# container start so one image serves every stack (empty env = baked config)
COPY --chmod=755 deploy/nginx/40-runtime-config.sh /docker-entrypoint.d/40-runtime-config.sh
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
EXPOSE 80
