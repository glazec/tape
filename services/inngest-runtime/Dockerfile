FROM inngest/inngest:v1.38.1@sha256:e71ee5b7b540cf764050d5a4a544cd4b76d9d39cb2802d8abc2d3ae21df92503

EXPOSE 8288
EXPOSE 8289

ENTRYPOINT ["inngest"]
CMD ["start", "--host", "0.0.0.0", "--port", "8288", "--connect-gateway-port", "8289"]
