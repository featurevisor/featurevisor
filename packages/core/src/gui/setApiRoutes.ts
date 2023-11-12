export function setApiRoutes(deps, fastify) {
  fastify.get("/api", async () => {
    return { hello: "world" };
  });

  /**
   * User
   */

  // @TODO: GET /api/user
  // @TODO: PUT /api/user

  /**
   * Attributes
   */

  // @TODO: GET    /api/attributes
  // @TODO: GET    /api/attributes/:attribute
  // @TODO: POST   /api/attributes/:attribute
  // @TODO: PUT    /api/attributes/:attribute
  // @TODO: DELETE /api/attributes/:attribute

  /**
   * Segments
   */

  // @TODO: GET    /api/segments
  // @TODO: GET    /api/segments/:segment
  // @TODO: POST   /api/segments/:segment
  // @TODO: PUT    /api/segments/:segment
  // @TODO: DELETE /api/segments/:segment

  /**
   * Features
   */

  // @TODO: GET    /api/features
  // @TODO: GET    /api/features/:feature
  // @TODO: POST   /api/features/:feature
  // @TODO: PUT    /api/features/:feature
  // @TODO: DELETE /api/features/:feature

  /**
   * Groups
   */

  // @TODO: GET    /api/groups
  // @TODO: GET    /api/groups/:group
  // @TODO: POST   /api/groups/:group
  // @TODO: PUT    /api/groups/:group
  // @TODO: DELETE /api/groups/:group
}
