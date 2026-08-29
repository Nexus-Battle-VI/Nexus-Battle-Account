# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Etapa 1 — dependencias de compilacion
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# Etapa 2 — compilacion con el Nest CLI
# ---------------------------------------------------------------------------
FROM node:24-alpine AS build

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src

RUN npm run build

# ---------------------------------------------------------------------------
# Etapa 3 — dependencias de produccion unicamente
# ---------------------------------------------------------------------------
FROM node:24-alpine AS prod-deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ---------------------------------------------------------------------------
# Etapa 4 — imagen final
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000

WORKDIR /app

# La imagen base ya define el usuario sin privilegios `node` (uid 1000).
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# ---------------------------------------------------------------------------
# Un lugar donde el proceso pueda escribir de verdad.
#
# `/app` pertenece a root en modo 755 y el proceso corre como `node` (uid 1000),
# asi que el valor por defecto de la configuracion -`./data/avatars`, relativo a
# `/app`- **no se podia crear**: `mkdir` fallaba con `Permission denied` y todo
# registro respondia 500. El avatar se guarda antes que cualquier otra cosa, de
# modo que ese fallo tapaba el resto del caso de uso.
#
# Rebajar los permisos de `/app` habria sido la solucion equivocada: el codigo y
# las dependencias deben seguir siendo de solo lectura para el proceso. Lo que
# hacia falta era un directorio aparte, para datos mutables y nada mas.
#
# Se declara tambien en `ENV` para que la imagen sea correcta **por si sola**,
# sin depender de que quien la despliegue recuerde configurar la variable. La
# configuracion mantiene `./data/avatars` como valor por defecto porque en
# desarrollo local escribir en `/var/lib` no es razonable.
#
# Conviene montar aqui un volumen: sin el, los avatares viven dentro de la capa
# de escritura del contenedor y desaparecen en cada despliegue.
# ---------------------------------------------------------------------------
RUN mkdir -p /var/lib/nexus/avatars && chown -R node:node /var/lib/nexus

ENV AVATAR_STORAGE_PATH=/var/lib/nexus/avatars

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT??3000)+'/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
