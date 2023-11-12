module.exports = function setupMockServer(devServer) {
  // root
  devServer.app.get("/api", function (req, res) {
    res.json({ data: {} });
  });

  // user
  devServer.app.get("/api/user", function (req, res) {
    res.json({
      data: {
        name: "Mock User",
        email: "mockuser@example.com",
      },
    });
  });
};
