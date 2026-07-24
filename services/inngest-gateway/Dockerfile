FROM golang:1.24-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/inngest-gateway .

FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=build /out/inngest-gateway /inngest-gateway

EXPOSE 8080

ENTRYPOINT ["/inngest-gateway"]
