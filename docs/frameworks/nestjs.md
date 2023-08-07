---
title: Nest.js
description: Learn how to integrate Featurevisor in Nest.js applications
ogImage: /img/og/docs-frameworks-nest.png
---

Set up Featurevisor SDK instance in a Nest.js application using a custom middleware, including TypeScript integration. {% .lead %}

## Hello World application

Before going into Featurevisor integration, let's create a simple Hello World [Nest.js](https://nestjs.com/) application.

We start by installing the Nest CLI:

```bash
$ npm install -g @nestjs/cli
```

Then we create a new Nest.js project:

```bash
$ nest new featurevisor-nest-app
$ cd featurevisor-nest-app
```

## Featurevisor integration

We install the Featurevisor SDK first:

```bash
$ npm install --save @featurevisor/sdk
```

We can now create an instance of the SDK and use it in our application:

```typescript
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createInstance, FeaturevisorInstance } from '@featurevisor/sdk';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const DATAFILE_URL = 'https://cdn.yoursite.com/datafile.json';
  const REFRESH_INTERVAL = 60 * 5; // every 5 minutes

  const f: FeaturevisorInstance = createInstance({
    datafileUrl: DATAFILE_URL,
    refreshInterval: REFRESH_INTERVAL,
  });

  app.use((req, res, next) => {
    req.f = f;

    next();
  });

  await app.listen(3000);
}
bootstrap();
```

## middleware

To use the same Featurevisor SDK instance in all of our routes, we can create a custom middleware in Nest.js.

Create a new file featurevisor.middleware.ts:

```typescript
// featurevisor.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { FeaturevisorInstance, createInstance } from '@featurevisor/sdk';

@Injectable()
export class FeaturevisorMiddleware implements NestMiddleware {
  private readonly f: FeaturevisorInstance;

  constructor() {
    const DATAFILE_URL = 'https://cdn.yoursite.com/datafile.json';
    const REFRESH_INTERVAL = 60 * 5; // every 5 minutes

    this.f = createInstance({
      datafileUrl: DATAFILE_URL,
      refreshInterval: REFRESH_INTERVAL,
    });
  }

  use(req: Request, res: Response, next: NextFunction) {
    req.f = this.f;

    next();
  }
}
```

And then update the main.ts file to use the middleware:

```typescript
Copy code
// main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { FeaturevisorMiddleware } from './featurevisor.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.use(new FeaturevisorMiddleware().use);

  await app.listen(3000);
}
bootstrap();
```

## Using Featurevisor in a route

Now you can use the Featurevisor SDK instance in your routes:

```typescript
// cats.controller.ts
import { Controller, Get, Req } from '@nestjs/common';
import { Request } from 'express';

@Controller('cats')
export class CatsController {
  @Get()
  getCats(@Req() req: Request) {
    const { f } = req;

    const featureKey = 'myFeature';
    const context = { userId: 'user-123' };

    const isEnabled = f.isEnabled(featureKey, context);

    if (isEnabled) {
      return 'Hello Cats!';
    } else {
      return 'Not enabled for cats yet!';
    }
  }
}
```

## TypeScript usage

If you are using TypeScript, you can extend the `Request` interface to add the `f` property for Featurevisor SDK's instance.

Create a new `featurevisor.d.ts` file in the `src` folder and make sure to include it in `tsconfig.json`:

```typescript
// src/featurevisor.d.ts
import { FeaturevisorInstance } from '@featurevisor/sdk';

declare module 'express' {
  interface Request {
    f: FeaturevisorInstance;
  }
}
```
