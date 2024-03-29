---
title: Glossary
description: Glossary of terms that you will come across when adopting feature management principles with Featurevisor
ogImage: /img/og/docs-glossary.png
---

Featurevisor is a tool that helps you adopt feature management practices in your organization and applications. This also introduces a lot of new terms, and this glossary is aimed at helping you understand quickly what they are all about. {% .lead %}

## A/B Test

An A/B test is a method of comparing two (or more) variations of a feature to determine which one performs better.

It involves dividing users into two (or more) groups and showing each group a different variation of the feature. The feature could be the colour or placement of a call to action button in a landing page for example.

The performance of each variation is then measured based on user behavior, such as click-through rates or conversion rates, to determine which variation is more effective.

Learn more in [Experments](/docs/use-cases/experiments) guide.

## Activation

When a particular user is exposed to an experiment, applications are required to activate that experiment for that user by tracking it accordingly against the evaluated variation.

This then helps measure the performance of the experiment itself later against your conversion goals.

See how SDKs help with tracking activations [here](/docs/sdks/javascript/#activation).

## Application

An application could either be your:

- Web application
- iOS app
- Android app
- Backend service
- Command line tool
- ...or anything else that you build

Featurevisor provides [SDKs](/docs/sdks/) in a few different programming languages to help you integrate it.

## Approval

Because Featurevisor adopts [GitOps](/docs/concepts/gitops) principles, all changes go via Pull Requests.

When you send Pull Requests, you often require approvals from your peers before merging them (applying the changes).

## Archive

Featurevisor entities can be archived at your convenience:

- [Archiving an attribute](/docs/attributes/#archiving)
- [Archiving a segment](/docs/segments/#archiving)
- [Archiving a feature](/docs/features/#archiving)

## Array

Arrays are a data structure that allowing you to define a list of items. Featurevisor supports variables, where `array` is one of the supported types.

You can learn more about using arrays as variables [here](/docs/features/#array).

## Assertion

Featurevisor allows testing your features and segments, to make sure they are working as your expectation before applying any changes anywhere.

A single test can consist of one or more assertions. Each assertion is basically a test scenario for your feature or segment.

Learn more about testing [here](/docs/testing).

## Attribute

An attribute is one of the core building blocks of Featurevisor. You can consider them to be like field names which are using in conditions inside segments.

Learn more about attributes [here](/docs/attributes).

## Boolean

A boolean type is a data type that represents two possible values: `true` and `false`. You may consider it to be like an on/off switch.

In Featurevisor, it can apply to few different areas:

- If Feature itself is [enabled or disabled](/docs/sdks/javascript/#checking-if-enabled)
- Boolean type for [variables](/docs/features/#boolean)

## Browser

Browsers help you access web applications. If you are using Chrome, Firefox, or Safari, then you are using a browser already.

## Bucketing

Bucketing is the process how we make sure a particular user is constistently seeing a feature as enabled/disabled or a specific variation (if an A/B test experiment) across all sessions and devices in your application(s).

Learn more about bucketing [here](/docs/bucketing).

## Build

Featurevisor has a build step, where it generates datafiles (JSON files) for your project against your environments and tags.

Learn more about building datafiles [here](/docs/building-datafiles).

## CI/CD

CI stands for Continuous Integration, which is a software development practice that involves frequently merging code changes into a shared repository. It ensures that each code change is tested and integrated with the existing codebase as early as possible.

CD stands for Continuous Deployment, which is an extension of Continuous Integration. It automates the process of deploying software changes to production environments after passing the necessary tests and quality checks. It enables teams to deliver software updates quickly and frequently to end-users.

## CLI

CLI stands for Command Line Interface. It is a text-based interface that allows users to interact with a computer program or operating system by typing commands into a terminal or command prompt.

Learn more [here](/docs/cli).

## Condition

Conditions are the building blocks of your segments. Learn more in [segments](/docs/segments).

## Context

When Featurevisor SDKs evaluate a feature or its variation and variables, it expects to receive some additional information about the user. Based on this information, SDKs then return you the desired value for that specific user.

This additional info could be:

- the User's ID
- their location
- browser name
- ...etc

We call this information `context`. You can learn more about how it's used in SDKs [here](/docs/sdks/javascript/#context).

##  Conversion goal

A conversion goal is a specific action or event that you want your users to take or achieve when interacting with your application(s).

It represents a desired outcome or objective, such as making a purchase, signing up for a newsletter, or completing a form. Conversion goals are used to measure the success and effectiveness of your features or experiments by tracking the percentage of users who successfully complete the desired action.

## Datafile

Featurevisor generates datafiles (JSON files) which are then consumed by SDKs in your application(s).

Learn more here about:

- [Building datafiles](/docs/building-datafiles)
- [Consuming datafiles](/docs/sdks/javascript/#initialization)

## Deployment

Once your datafiles are generated, the idea is to upload it to a CDN (or a custom server) so that your applications can access and fetch these files.

You can learn more about deployment strategies [here](/docs/deployment).

## Deprecate

It can be very easy to keep creating new features, but not always a nice experience when you wish to get rid of them. The challenge mostly comes from having to figure out which applications are already using those features (if any).

This is where deprecation comes in handy. Deprecating a feature in Featurevisor means we are choosing to remove any usage of it, but we are not deleting it yet.

Any SDK that evaluates deprecated features will emit warnings so the developers are notified about it and are given enough time to remove the usage of those features from their applications.

Learn more about it [here](/docs/features/#deprecating).

## Declarative

Featurevisor takes a declarative approach to defining all our configuration in the form of attributes, segments, and features.

By being declarative, it means that we are only declaring (telling the system) what outcome we desire, and then Featurevisor takes care of everything else.

These concepts can help you understand more about it:

- [Infrastructure as Code (IaC)](/docs/concepts/infrastructure-as-code)
- [GitOps](/docs/concepts/gitops)

## Description

All Featurevisor entities expect descriptions, to help document what they are intended to be used for.

## Double

Featurevisor allows `double` as a data type for variables, which allows you to have numbers with decimal places.

Learn more about its usage [here](/docs/features/#double).

## Entity

All the building blocks of Featuervisor are called entities, which are:

- [Attribute](/docs/attributes)
- [Segment](/docs/segments)
- [Feature](/docs/features)
- [Group](/docs/groups)

## Environment

In software engineering, an environment refers to the specific configuration and settings in which a software application or system operates.

If you are an application developer, it may mean:

- **staging environment**: where you test your application out before deploying to production
- **production environment**: where your real users access your application

## Evaluation

Evaluation is the process how Featurevisor SDKs compute the values of feature's own enabled/disabled status and its variations and variables, against a given context.

Learn more in [SDKs](/docs/sdks/) page.

## Experiment

Experiments can be of two types in Featurevisor:

- A/B test
- Multivariate tests

Even though they are experiments in traditional terms, in Featurevisor everything is defined as a feature (either it's a simple feature with enabled/disabled status, or one with also variations).

Learn more about them in [Experiments](/docs/use-cases/experiments) guide.

## Expose

Exposing a feature in a specific environment is an advanced concept which is very handy when you are migrating away from another feature management tool to Featurevisor.

There might be cases where you want Featurevisor to be used in staging environment for a specific feature first, while still using the previous existing tool in production.

Learn more how exposing works on a per environment basis [here](/docs/features/#expose).

## Feature

Either you want a:

- simple feature flag with enabled/disabled status, or
- one with variations to be treated as an experiment, or
- one with variables for more complex configuration

...everthing is defined as a feature in Featurevisor.

A feature is the core building block, and you can learn more about its anatomy [here](/docs/features).

## Fetch

Fetching is the process of how Featurevisor SDKs pull in the latest datafiles over the network which packs all the configuration for evaluating all your features in your application against provided contexts.

## Flag

These terms are often used interchangeably:

- Feature
- Feature flag
- Flag

## Force

While you may set up all your rules inside a feature targeting various conditions, you may want to override them all for certain users, especially when you wish to test things out yourself before affecting your real users.

This guide for testing in production will explain the use case well [here](/docs/use-cases/testing-in-production).

The `force` API docs can be found [here](/docs/features/#force).

## Git

Git is a distributed version control system that allows multiple people to work on a project at the same time without overwriting each other's changes. It tracks changes to files in a repository (think a project) so you can see what was changed, who changed it, and why.

Git is widely used in software development for source code management. With Featurevisor, all feature configurations are stored in a Git repository that we call our Featurevisor project.

## GitHub

GitHub is a web-based hosting service for version control using Git. It provides a platform for collaboration, allowing developers to contribute to projects, fork repositories, submit pull requests, and manage versioned files.

## GitHub Actions

GitHub Actions is a CI/CD (Continuous Integration/Continuous Deployment) service provided by GitHub. It allows developers to automate, customize, and execute their software development workflows right in their GitHub repository.

Actions can be used to build, test, and deploy applications, manage issues, publish packages, and much more. Workflows are defined using YAML syntax and can be triggered by various GitHub events such as push, pull requests or issue creation.

## GitOps

In its simples form GitOps means doing operations using Git.

Read our [GitOps](/docs/concepts/gitops) guide for more info.

## Group

When you wish to run mutually exclusive experiments, meaning the same user should be exposed to two or more overlapping experiments, groups come in handy.

Learn more about groups [here](/docs/groups).

## Hash

Featurevisor SDKs rely on in-memory hashing algorithm making sure same user is bucketed into same feature and variation based on rollout rules consistently.

Learn more about it in our guide for [bucketing](/docs/bucketing).

## Integer

If you wish to define variables which are whole numbers (without decimal places), then `integer` type is what you need.

Learn more about integer type's usage in variables [here](/docs/features/#integer).

## Interval

Featurevisor SDKs allow refreshing datafiles, and one of the techniques can be interval based, meaning it can keep refreshing the datafile (your features configuration) every X number of seconds.

You can learn more about refreshing in SDKs [here](/docs/sdks/javascript/#refreshing).

## JavaScript

JavaScript is a high-level, interpreted programming language primarily used for enhancing web pages to provide a more interactive user experience. It's one of the core technologies of the web, alongside HTML and CSS.

Featurevisor CLI is written in JavaScript, targeting Node.js runtime.

But the JavaScript SDK is universal, meaning it works in both browsers and in Node.js.

## JSON

JSON (JavaScript Object Notation) is a lightweight data-interchange format that is easy for humans to read and write and easy for machines to parse and generate.

It's often used to transmit data between a server and an application.

From Featurevisor's perspective, it builds datafiles (which are JSON files). These datafiles are then fetched and consumed by applications using Featurevisor SDKs in various different programming languages.

## Key

Keys may mean the name of your Featurevisor entities like attribute, segments, and features.

When [variables](/docs/features/#variables) are defined inside a feature, they are also given unique keys within their features.

As for [rules](/docs/features/#rules) within environments, they also have their own keys.

## Lint

Entities are expressed declaratively in Featurevisor, primarily as YAML or JSON files.

To make sure they do not contain any human introduced mistakes, linting takes care of finding those issues early (if any) before proceeding with building datafiles.

Learn more about linting [here](/docs/linting).

## Merge

When you send a Pull Request making changes to the configuration of your desired Featurevisor entities, you then proceed with merging it to finally apply the changes so it impacts your applications.

## Multivariate Test

Traditionally with A/B tests, you test a single variation change.

With multivariate tests, multiple variables are modified for testing a hypothesis.

Learn about it more depth in our [Experiments](/docs/use-cases/experiments) guide.

## Mutually Exclusive

When you do not wish to expose a single user to more than one experiment at a time from your list of predefined experiments.

Featurevisor allows you to achieve that via [Groups](/docs/groups).

## Name

The word **name** may often be used interchangeaby with **key**.

Like your feature name or key.

## Native apps

Usually means applications which are build specifically for a platform, like iOS and Android apps.

## Node.js

JavaScript the programming language was originally introduced to work in browsers only. With the introduction of Node.js, whis is an open-source, cross-platform, JavaScript runtime environment, allowed executing code written in this language outside of a web browser as well.

This includes server-side and command line applications.

Featurevisor CLI is a Node.js package allowing you to use it via command line in Terminal.

While Featurevisor JavaScript SDK works in both browsers and in Node.js services.

## npm

npm is a package manager for Node.js.

Like millions of other open source packages, Featurevisor is also distributed via npm.

As application builders and users of Featurevisor, we download Featurevisor packages via npm.

## Object

Featurevisor allows defining plain objects (key/value pairs of data) in variables.

Learn more about its usage [here](/docs/features/#object).

## Operator

When we define segments, it will contain various different conditions. And each of those conditions will use operators like `equals`, `notEquals`, and more.

See full list of supported operators [here](/docs/segments/#operators).

## Override

Variations and variables inside features can be overriden in few different ways allowing more flexibility as our configurations grow more complex.

Learn more about them here:

- [Overriding variation](/docs/features/#overriding-variation)
- [Overriding variables](/docs/features/#overriding-variables)

## Parser

By default, Featurevisor expects all entities will be defined as YAML files. With native support of choosing JSON as well.

Next to that, the configuration API allows you to bring in your own parser for different formats like TOML, XML, etc.

Learn more about them here:

- [Custom parsers](/docs/advanced/custom-parsers)
- [Project configuration](/docs/configuration)

## Percentage

Not all releases of your features should be a big bang release affecting all your users. You may want to roll it out gradually, starting with 5%, then 10%, then 20%, and all the way up to 100% as you gain more confidence.

These percentages are defined in your rollout [rules](/docs/features/#rules) inside features.

Learn more about gradual rollouts and progressive delivery [here](/docs/use-cases/progressive-delivery).

## Pretty

When machines deal with JSON files, they usually are in their most compressed form to save disk space and network bandwidth. When compressed, they also affect readability for humans negatively.

For debugging (investigating) purposes, there's an option in Featurevisor's project configuration to allow for [pretty datafiles](/docs/configuration/#pretty-datafile) and [state files](/docs/configuration/#pretty-state) improving readability for humans.

## Production

Refers to the production environment, where your application(s) are deployed to affecting your real users.

## Project

Your Featurevisor project, which is usually a single independent Git repository.

See quick start guide on how to create a new project [here](/docs/quick-start).

## Pull Request

A pull request is a feature in version control systems like Git, and platforms like GitHub, that allows developers to propose changes to a codebase.

It's a request to "pull" your changes into the main project. Pull requests show content differences, facilitate discussions, code review, and can be integrated with other testing and CI/CD tools before the changes are merged into the main branch.

## QA

Many organizations have Quality Assurance (QA) teams, making sure everything is working as expected before the changes of your applications are exposed to your real users, minimizing any potential risks.

## Ready

When Featurevisor SDKs are used [asynchronously](/docs/sdks/javascript/#initialization), we are delegating the responsibility of fetching the datafile to the SDK itself.

The fetching of datafile is an asynchronous task over the network. To know when Featurevisor SDK has successfully fetched the datafile, we rely on its readiness events.

Learn more about their usage here:

- [onReady option](/docs/sdks/javascript/#asynchronous)
- [isReady method](/docs/sdks/javascript/#listening-to-events)
- [onReady method](/docs/sdks/javascript/#listening-to-events)

## Refresh

Featurevisor SDKs allow refreshing datafile content without having to restart or reload your whole application.

Learn more about refreshing [here](/docs/sdks/javascript/#refreshing).

## Repository

A repository, often abbreviated as "repo", is a storage location for software packages. It contains all files and directories associated with a project.

From Featurevisor's perspective, a single project is usually its own indepedent Git repository consisting of files which are defining various entities like attributes, segments, and features.

## Review

When we send Pull Requests, the idea is to get it reviewed by our peers who may either approve, reject, or request for more changes.

## Revision

Each successful build of Featurevisor datafiles produce a new revision number. This is in integer format, and is incremented by 1 from previous build's revision.

This revision number is present in all generated datafiles, so applications will know which revision they are using with provided SDKs.

Learn more about it:

- [Building datafiles](/docs/building-datafiles)
- [State files](/docs/state-files)

## Rule

Rollout rules are defined per environment for each individual features.

Learn more about rules [here](/docs/features/#rules).

## Schema

When variables are defined inside a feature, they must also provide their own schema to let Featurevisor know more about it.

Learn more about variables schema [here](/docs/features/#variables).

## SDK

SDK stands for Software Development Kit.

Featurevisor comes with [SDKs](/docs/sdks) in a few different programming languages. Their purpose is to fetch datafiles and evaluate values in your applications as you need them.

## Segment

Segments are groups of conditions, which are then used in the rollout rules of your features.

Learn more about segments [here](/docs/segments).

## Site

Featurevisor is also capable of generating a static read-only website based on all entity definitions as found in your project repository.

This generated site, once hosted, serves as a dashboard for your team and organization for understanding what's the latest state of configuration everywhere.

Learn more about it [here](/docs/site).

## Staging

Similar to production, staging is a common environment in engineering culture.

This environment is meant to serve for testing things out internally within the team, before deploying the changes to production where your real users are.

## State files

Because there's no real database involved in Featurevisor, the tool uses Git for storing and keeping track of all traffic allocation informaton against rollout rules in features, and revision numbers.

Learn more about them and their usage here:

- [State files](/docs/state-files)
- [Deployment](/docs/deployment)

## String

String is a data type that's used for texts. It is one among many other data types that's supported in variables.

Learn more about it [here](/docs/features/#string).

## Tag

Your organization may have a single Featurevisor project, in a single Git repository, containing several hundres or thousands of features.

But there might be 10 or more separate consumers (applications), and they each may want to fetch datafiles for only a subset of all the features found in your project.

This is where tagging comes in handy. Each feature can be tagged accordingly, and datafile generator will take care of building tag specific files for your applications to consume.

Learn more about it here:

- [Building datafiles](/docs/building-datafiles)
- [Tags in features](/docs/features/#tags)

## Terminal

A Terminal, also known as a command line or console, is a text-based interface used to interact with an operating system. Users can input commands to perform operations, navigate the file system, and run scripts or applications.

If you are using macOS, then this is your Terminal app.

## Testing

Unlike any other feature management tools, Featurevisor allows your to test your segments and features against your expectations.

This is similar to "unit testing" in regular programming.

Just like how features and segments are defined declaratively, you can also define your tests for them declaratively, and Featurevisor will test everything for you.

Learn more about it [here](/docs/testing).

## Tracking

Experiments are of no use if we are not tracking anything.

Featurevisor SDKs emit [activation] events, which can be handled and then tracked accordingly using your favourite analytics service.

Here's a [guide](/docs/tracking/google-analytics) about how Google Analytics can be used together with Google Tag Manager.

## Usage

Sometimes we create segments and attributes, and we can't always tell quickly where they are actively being used.

Featurvisor CLI brings in some goodies to help find their usage, and also entities which are not used anywhere so you can take actions to clean them up.

Learn more about it [here](/docs/cli/#find-usage).

## Value

A value can be anything. This paragraph that you are reading can be a value.

In terms of Featurevisor, a value can be the evaluated output of a:

- feature's own enabled/disabled status
- feature's variation
- feature's variable

## Variable

Variables are key/value pairs of data that be defined inside individual features.

Learn more about their usage here:

- [Defining variables in features](/docs/features/#variables)
- [Evaluating variables using SDKs](/docs/sdks/javascript/#getting-variables)

## Variation

Defining variations in features allow you to turn them into A/B or Multivariate test experiments.

Learn more about their usage here:

- [Defining variations in features](/docs/features/#variations)
- [Evaluating variations using SDKS](/docs/sdks/javascript/#getting-variations)

## Weight

When we define variations in our features, we also have to provide weights for each variation for splitting their traffic distribution.

If you have only two variations, it could be a 50-50 split or a 20-80 split, depending on your needs. It's totally up to do you define them.

Learn more about variations [here](/docs/features/#variations).

## YAML

YAML, which stands for "YAML Ain't Markup Language".

It's a human-friendly data serialization standard and is often used for configuration files and in applications where data is being stored or transmitted.

YAML is designed to be readable and easily editable by humans, and it allows complex data structures to be expressed in a natural and minimal syntax.
