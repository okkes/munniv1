# Multi-stage build for the sync API — arch-agnostic: CI builds it
# natively per platform (amd64 NAS, arm64 Pi) and merges the manifest
FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src
COPY src/Munni.Api/Munni.Api.csproj src/Munni.Api/
RUN dotnet restore src/Munni.Api/Munni.Api.csproj
COPY src/ src/
RUN dotnet publish src/Munni.Api/Munni.Api.csproj -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0-alpine
# ICU for proper globalization (currency/date formatting server-side)
RUN apk add --no-cache icu-libs
ENV DOTNET_SYSTEM_GLOBALIZATION_INVARIANT=false
WORKDIR /app
COPY --from=build /app .
USER app
EXPOSE 8080
ENTRYPOINT ["dotnet", "Munni.Api.dll"]
