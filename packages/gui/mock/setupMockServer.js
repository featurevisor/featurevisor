const path = require("path");

const express = require("express");
const { getProjectConfig, Datasource } = require("@featurevisor/core");

const ROOT_DIR = path.join(__dirname, "..", "..", "..");
const EXAMPLE_1_PATH = path.join(ROOT_DIR, "examples", "example-1");

/**
 * Function setting up dev server for /api endpoints
 */
module.exports = function setupMockServer(devServer) {
  devServer.app.use(express.json());

  /**
   * Stateful data
   */
  let user = {
    name: "Mock User",
    email: "mockuser@example.com",
  };

  const entities = {
    attributes: [],
    segments: [],
    features: [],
    groups: [],
  };

  /**
   * Start with an example project's data in memory
   */
  const projectConfig = getProjectConfig(EXAMPLE_1_PATH);
  const datasource = new Datasource(projectConfig);

  let isReady = false;

  devServer.app.use(async function (req, res, next) {
    console.log(`[${req.method}]`, req.url);

    if (isReady) {
      return next();
    }

    console.log("Loading data from example project as one-off operation...");

    // attributes
    const attributesList = await datasource.listAttributes();
    for (const attributeKey of attributesList) {
      const attribute = await datasource.readAttribute(attributeKey);
      entities.attributes.push({
        key: attributeKey, // @TODO: verify that datasource is returning `key` property
        ...attribute,
      });
    }

    // segments
    const segmentsList = await datasource.listSegments();
    for (const segmentKey of segmentsList) {
      const segment = await datasource.readSegment(segmentKey);
      entities.segments.push({
        key: segmentKey,
        ...segment,
      });
    }

    // features
    const featuresList = await datasource.listFeatures();
    for (const featureKey of featuresList) {
      const feature = await datasource.readFeature(featureKey);
      entities.features.push({
        key: featureKey,
        ...feature,
      });
    }

    // groups
    const groupsList = await datasource.listGroups();
    for (const groupKey of groupsList) {
      const group = await datasource.readGroup(groupKey);
      entities.groups.push({
        key: groupKey,
        ...group,
      });
    }

    console.log("Loaded successfully");

    isReady = true;

    next();
  });

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

  /**
   * Attributes
   */
  devServer.app.get("/api/attributes", function (req, res) {
    res.json({
      data: entities.attributes,
    });
  });

  devServer.app.get("/api/attributes/list", function (req, res) {
    res.json({
      data: entities.attributes.map((attribute) => attribute.key),
    });
  });

  devServer.app.get("/api/attributes/:key", function (req, res) {
    const attribute = entities.attributes.find((attribute) => attribute.key === req.params.key);

    if (!attribute) {
      return res.status(404).json({
        error: {
          message: "Attribute not found",
        },
      });
    }

    res.json({
      data: attribute,
    });
  });

  /**
   * Segments
   */
  devServer.app.get("/api/segments", function (req, res) {
    res.json({
      data: entities.segments,
    });
  });

  devServer.app.get("/api/segments/list", function (req, res) {
    res.json({
      data: entities.segments.map((segment) => segment.key),
    });
  });

  devServer.app.get("/api/segments/:key", function (req, res) {
    const segment = entities.segments.find((segment) => segment.key === req.params.key);

    if (!segment) {
      return res.status(404).json({
        error: {
          message: "Segment not found",
        },
      });
    }

    res.json({
      data: segment,
    });
  });

  /**
   * Features
   */
  devServer.app.get("/api/features", function (req, res) {
    res.json({
      data: entities.features,
    });
  });

  devServer.app.get("/api/features/list", function (req, res) {
    res.json({
      data: entities.features.map((feature) => feature.key),
    });
  });

  devServer.app.get("/api/features/:key", function (req, res) {
    const feature = entities.features.find((feature) => feature.key === req.params.key);

    if (!feature) {
      return res.status(404).json({
        error: {
          message: "Feature not found",
        },
      });
    }

    res.json({
      data: feature,
    });
  });

  /**
   * Groups
   */
  devServer.app.get("/api/groups", function (req, res) {
    res.json({
      data: entities.groups,
    });
  });

  devServer.app.get("/api/groups/list", function (req, res) {
    res.json({
      data: entities.groups.map((group) => group.key),
    });
  });

  devServer.app.get("/api/groups/:key", function (req, res) {
    const group = entities.groups.find((group) => group.key === req.params.key);

    if (!group) {
      return res.status(404).json({
        error: {
          message: "Group not found",
        },
      });
    }

    res.json({
      data: group,
    });
  });
};
