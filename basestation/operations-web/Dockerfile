FROM node:22-alpine AS build
WORKDIR /workspace/gui
COPY gui/package.json gui/package-lock.json ./
RUN npm ci
COPY gui/ ./
RUN npm run build -- --configuration production

FROM nginx:1.27-alpine
COPY basestation/operations-web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /workspace/gui/dist/deakin-rover-gui/browser /usr/share/nginx/html
EXPOSE 80
