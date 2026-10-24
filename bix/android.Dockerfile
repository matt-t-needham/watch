# Builds the Materialious Android app (Capacitor) the way upstream's
# prod-android workflow does: npm build (static adapter) → cap sync →
# gradlew assembleRelease. The result is unsigned; bix/build-apk.sh signs it.
# Build context: materialious/ (the SvelteKit app).

FROM eclipse-temurin:21-jdk-jammy AS sdk
RUN apt-get update && apt-get install -y --no-install-recommends unzip curl ca-certificates xz-utils git \
 && rm -rf /var/lib/apt/lists/*
# Node 24, as upstream's CI. Checksum from nodejs.org's SHASUMS256.txt.
ARG NODE_VERSION=24.11.1
RUN curl -fsSL -o /tmp/node.tar.xz https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz \
 && curl -fsSL https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt | grep " node-v${NODE_VERSION}-linux-x64.tar.xz\$" | sed 's#  .*#  /tmp/node.tar.xz#' | sha256sum -c - \
 && tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 \
 && rm /tmp/node.tar.xz
ENV ANDROID_HOME=/opt/android
# Checksum as published on developer.android.com for this release.
RUN curl -fsSL -o /tmp/ct.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
 && echo "2d2d50857e4eb553af5a6dc3ad507a17adf43d115264b1afc116f95c92e5e258  /tmp/ct.zip" | sha256sum -c - \
 && mkdir -p $ANDROID_HOME/cmdline-tools \
 && unzip -q /tmp/ct.zip -d $ANDROID_HOME/cmdline-tools \
 && mv $ANDROID_HOME/cmdline-tools/cmdline-tools $ANDROID_HOME/cmdline-tools/latest \
 && rm /tmp/ct.zip
RUN yes | $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager --licenses > /dev/null \
 && $ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools" > /dev/null
ENV PATH=$ANDROID_HOME/build-tools/36.0.0:$PATH

FROM sdk AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY shared/package.json shared/package-lock.json* shared/
COPY static/nodejsAndroid/ static/nodejsAndroid/
COPY scripts/ scripts/
RUN npm ci && (cd shared && npm ci) && (cd static/nodejsAndroid && npm ci)

FROM deps AS build
ARG VERSION_CODE=1
ARG VERSION_NAME=dev
COPY . .
RUN npm run build && npm prune --omit=dev && npx cap sync android
WORKDIR /src/android
# Gradle downloads its wrapper and dependencies here; cache them between builds.
RUN --mount=type=cache,target=/root/.gradle \
    sed -i -e "s/versionCode [0-9]*/versionCode ${VERSION_CODE}/" \
           -e "s/versionName \"[^\"]*\"/versionName \"${VERSION_NAME}\"/" app/build.gradle \
 && bash gradlew --no-daemon -q assembleRelease \
 && cp app/build/outputs/apk/release/*universal*-unsigned.apk /unsigned.apk
