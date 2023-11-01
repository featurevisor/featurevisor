export function setApiRoutes(deps, fastify) {
  fastify.get("/api", async (request, reply) => {
    return { hello: "world" };
  });
}
