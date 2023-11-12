/**
 * Stateful data
 */
let user = {
  name: "Mock User",
  email: "mockuser@example.com",
};

/**
 * Function setting up dev server for /api endpoints
 */
module.exports = function setupMockServer(devServer) {
  /**
   * Root
   */
  devServer.app.get("/api", function (req, res) {
    res.json({ data: {} });
  });

  /**
   * User
   */
  devServer.app.get("/api/user", function (req, res) {
    res.json({
      data: user,
    });
  });

  devServer.app.put("/api/user", function (req, res) {
    user = req.body;

    res.json({
      data: user,
    });
  });
};
