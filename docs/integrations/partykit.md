---
title: WebSocket & PartyKit
description: Learn how to integrate Featurevisor with PartyKit via WebSocket for realtime updates.
ogImage: /img/og/docs-integrations-partykit.png
---

Fetch latest configuration in already running applications using Featurevisor SDK as soon as there are latest datafile changes by listening to messages via [WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) powered by [PartyKit](https://partykit.io). {% .lead %}

## What do we mean by realtime updates?

Featurevisor SDK, once initialized with `datafileUrl` option, will fetch the [datafile](/docs/building-datafiles) containing our configuration from the provided URL. This is a one time operation and SDK will not fetch the latest configuration unless it is reinitialized (meaning, until our application restarts or reloads):

```js
import { createInstance } from "@featurevisor/sdk";

const DATAFILE_URL = "https://cdn.yoursite.com/datafile.json";

const f = createInstance({
  datafileUrl: DATAFILE_URL,
  onReady: () => console.log("SDK has initialized"),
});
```

This issue is partly mitigated by using the `refreshInterval` option, so that once the SDK is initialized, it can keep on fetching the datafile from the same URL every X number of seconds, in case it has new content:

```js
const f = createInstance({
  datafileUrl: DATAFILE_URL,
  onReady: () => console.log("SDK has initialized"),

  refreshInterval: 60, // every 60 seconds
  onRefresh: () => console.log("SDK has fetched the datafile again"),
  onUpdate: () => console.log("Latest datafile has new content"),
});
```

What it does internally is call the `refresh()` method of the SDK periodically, which we could also call manually ourselves:

```js
f.refresh();
```

However, this solution still means that our application will be using the old datafile content as configuration for theoretically maximum 60 seconds before it fetches the latest configuration again.

## Enter WebSocket

[WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) is a communication protocol that provides full-duplex communication channels over a single TCP connection.

By full-duplex, it means both the client and server can send messages to each other independently at the same time by keeping the connection alive.

Since WebSocket is a great way to keep a connection alive between the client and server, we can use this protocol to listen to events from a server that can tell us to trigger a new refresh as soon as there has been any new updates in our Featurevisor project (the Git repository).

## What is PartyKit?

[PartyKit]() is an open source deployment platform for AI agents, multiplayer and local-first apps, games, and websites.

It can help us create a new realtime service that we can send messages to from our CI/CD pipeline whenever there are new changes in our Featurevisor project, and then listen to those messages in our application(s) to trigger a new refresh via our SDK instance.

## Visualizing the whole flow in steps

- We have a Featurevisor project in a Git repository
- We have a CI/CD pipeline that builds our datafiles and deploys them to a CDN
  - The CI/CD pipeline will send a message to our PartyKit server whenever there are new changes in our Featurevisor project
- Our PartyKit server will receive the message and broadcast it to all connected apps
- Our application(s) will listen to the message and trigger a new refresh of our SDK instance

Let's start implementing this flow step by step.

## Create a new PartyKit server

We can init a new npm project and install PartyKit:

```
$ npm install --save partykit@beta
```

Then we create a new `server.js` file and add the following code:

```js
// replace with your own secret, and inject via environment variable
const PARTY_SECRET_VALUE = "party-secret";
const PARTY_SECRET_HEADER = "x-partykit-secret";

// the event type we will be broadcasting to all connected apps
const REFRESH_TYPE = "refresh";

export default {
  // handle incoming request coming from our CI/CD pipeline
  async onRequest(request, room) {
    if (request.method === "POST") {
      const body = await request.json();
      const secretInHeader = request.headers.get(PARTY_SECRET_HEADER);

      // once we identify the request is coming from our own CI/CD pipeline,
      // we broadcast a message to all connected apps
      if (secretInHeader === PARTY_SECRET_VALUE) {
        room.broadcast(
          JSON.stringify({
            type: REFRESH_TYPE,
          })
        );

        return new Response(
          `Message sent to ${room.connections.size} connected participants`
        );
      }
    }

    return new Response(`Nothing to see here.`);
  },
};
```

To test locally:

```
$ npx partykit dev server.js
```

Now that we have our server ready, we can deploy it:

```
$ npx partykit deploy server.js --name my-party
```

## Send a message from CI/CD pipeline

We can build on top of one of our existing guides on how to setup a CI/CD pipeline and deploy our generated datafiles using [GitHub Actions](/docs/integrations/github-actions) & [Cloudflare Pages](/docs/integrations/cloudflare-pages).

We can add a new step to our workflow that will send a message to our PartyKit server whenever there are new changes in our Featurevisor project:

```yml
# .github/workflows/publish.yml

# ...

jobs:
  publish:
    name: Publish
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      # ...

      # add new step here after uploading the generated datafiles
      name: Send message to PartyKit
      run: |
        curl -X POST \
          -H "Content-Type: application/json" \
          -H "X-PartyKit-Secret: <MY-SECRET-HERE>"
          -d '{"type": "refresh"}' \
          https://<project>.<username>.partykit.dev/party/featurevisor
```

The `X-PartyKit-Secret` is there so that our server only accepts messages from our own CI/CD pipeline and not from anyone else. You are free to take any other approach to better manage your security.

## Listening to messages in our application

Now that we have a PartyKit server that can receive messages from our CI/CD pipeline and also broadcast it to all connected applications, we (as one of those applications) can listen to those messages and trigger a new refresh of our SDK instance:

```js
import { createInstance } from "@featurevisor/sdk";

const DATAFILE_URL = "https://cdn.yoursite.com/datafile.json";
const WEBSOCKET_URL = "wss://<project>.<username>.partykit.dev/party/featurevisor";

const f = createInstance({
  datafileUrl: DATAFILE_URL,
  onReady: () => console.log("SDK has initialized"),
});

const socket = new WebSocket(WEBSOCKET_URL);
socket.onmessage = (event) => {
  const message = JSON.parse(event.data);

  if (message.type === "refresh") {
    f.refresh();
  }
};
```

Wish just a few lines of code, we just made our application listen to messages from our PartyKit server and trigger a new refresh of our SDK instance as soon as there are new changes in our Featurevisor project, making every feature update a realtime update.
