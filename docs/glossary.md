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

Learn more in [Experiments](/docs/use-cases/experiments) guide.

## Activation

When a particular user is exposed to an [experiment](#experiment), applications are required to activate that experiment for that user by tracking it accordingly.

The payload for tracking that activation event usually includes:

- The experiment key
- The evaluated variation
- The user's ID

This then helps measure the performance of the experiment itself later against your [conversion goals](#conversion-goal).

See how SDKs help with tracking activations [here](/docs/sdks/javascript/#activation).

## Application

An application could either be your:

- Web application
- iOS app
- Android app
- Backend service
- Command line tool
- ...or anything else that you build

Featurevisor provides [SDKs](/docs/sdks/) in a few different programming languages to help you evaluate your features.

## Approval

Because Featurevisor adopts [GitOps](/docs/concepts/gitops) principles, all changes are made via [Pull Requests](#pull-request).

When you send Pull Requests, you often require approvals from your peers before [merging](#merge) them (applying the changes).

## Archive

Featurevisor [entities](#entity) can be archived at your convenience:

- [Archiving an attribute](/docs/attributes/#archiving)
- [Archiving a segment](/docs/segments/#archiving)
- [Archiving a feature](/docs/features/#archiving)

Archiving here means that we still keep our entity definitions in place, but not serving their configuration to our applications via generated [datafiles](#datafile) any more.

## Array

Arrays are a data structure that allowing you to define a list of items. Featurevisor supports [variables](#variable), where `array` is one of the supported types.

You can learn more about using arrays as variables [here](/docs/features/#array).

## Assertion

Featurevisor allows [testing](#testing) your features and segments, to make sure they are working as per your expectations before applying any changes anywhere.

A single test can consist of one or more assertions. Each assertion is basically a test scenario for your feature or segment against [contexts](#context).

Learn more about testing [here](/docs/testing).

## Attribute

An attribute is one of the core building blocks of Featurevisor. You can consider them to be like field names which are using in conditions inside [segments](#segment).

Learn more about attributes [here](/docs/attributes).

## Boolean

A boolean type is a data type that represents two possible values: `true` and `false`. You may consider it to be like an on/off switch.

In Featurevisor, it can apply to a few different areas:

- If Feature itself is [enabled or disabled](/docs/sdks/javascript/#checking-if-enabled)
- Boolean type for [variables](/docs/features/#boolean)

## Branch

A [Git](#git) branch is a pointer to a specific sequence of [commits](#commit) in a [repository](#repository).

It represents an independent line of development in a project, allowing you to isolate changes for specific features or tasks. The default branch in Git is usually called `master` or `main`.

You can create, switch to, [merge](#merge), and delete branches using various Git commands. This branching mechanism facilitates collaboration, experimentation, and non-linear development workflows.

## Browser

Browsers help you access web applications. If you are using Chrome, Firefox, or Safari, then you are using a browser already.

## Bucketing

Bucketing is the process how we make sure a particular user is consistently seeing a feature as enabled/disabled or a specific variation (if an [A/B test](#a-b-test) experiment) across all sessions and devices in your application(s).

Learn more about bucketing here:

- [Bucketing concept](/docs/bucketing)
- [Configuring bucketing in features](/docs/features/#bucketing)

## Build

Featurevisor has a build step, where it generates [datafiles](#datafile) (JSON files) for your project against your [environments](#environment) and [tags](#tag).

Learn more about building datafiles [here](/docs/building-datafiles).

## CDN

A CDN, or Content Delivery Network, is a system of distributed servers that deliver web content to a user based on their geographic location, the origin of the webpage, and the content delivery server itself.

It's designed to reduce latency and increase the speed of web content delivery by serving content from the server closest to the user. CDNs are commonly used for serving static resources of a website like images, CSS, and JavaScript files.

Featurevisor expects that its generated [datafiles](#datafile) are [served](#deployment) via a CDN.

Examples of CDNs include:

- AWS Cloudfront
- Cloudflare
- Fastly

## CI/CD

CI stands for Continuous Integration, which is a software development practice that involves frequently merging code changes into a shared repository. It ensures that each code change is tested and integrated with the existing codebase as early as possible.

CD stands for Continuous Deployment, which is an extension of Continuous Integration. It automates the process of deploying software changes to production environments after passing the necessary tests and quality checks. It enables teams to deliver software updates quickly and frequently to end-users.

## CLI

CLI stands for Command Line Interface. It is a text-based interface that allows users to interact with a computer program or operating system by typing commands into a [terminal](#terminal) or command prompt.

Learn more [here](/docs/cli).

## Commit

A [Git](#git) commit is a command that saves changes to a local [repository](#repository). It's like a snapshot of your work that you can revert to or compare with other versions later.

Each commit has a unique ID (a hash), a message describing the changes, and information about the author.

Commits form a linear or branched history, allowing you to track progress and understand the evolution of a project.

## Condition

Conditions are the building blocks of your segments. Learn more in [segments](/docs/segments).

## Configuration

Featurevisor manages its project configuration via `featurevisor.config.js` file.

Learn more about project configuration [here](/docs/configuration).

## Context

When Featurevisor SDKs [evaluate](#evaluation) a feature or its variation and variables, it expects to receive some additional information about the user. Based on this information, SDKs then return you the desired value for that specific user.

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

Featurevisor generates datafiles ([JSON](#json) files) which are then consumed by [SDKs](#sdk) in your application(s).

Learn more here about:

- [Building datafiles](/docs/building-datafiles)
- [Consuming datafiles](/docs/sdks/javascript/#initialization)

## Deployment

Once your datafiles are generated, the idea is to upload it to a [CDN](#cdn) (or a custom server) so that your applications can access and [fetch](#fetch) these files.

You can learn more about deployment strategies [here](/docs/deployment).

## Deprecate

It can be very easy to keep creating new features, but not always a nice experience when you wish to get rid of them. The challenge mostly comes from having to figure out which [applications](#application) are already using those features (if any).

This is where deprecation comes in handy. Deprecating a feature in Featurevisor means we are choosing to remove any usage of it soon, but we are not deleting it yet for not impacting any existing applications negatively.

Any SDK that evaluates deprecated features will emit warnings so the developers are notified about it and are given enough time to remove the usage of those features from their applications.

Learn more about it [here](/docs/features/#deprecating).

## Declarative

Featurevisor takes a declarative approach to defining all our configuration in the form of [attributes](#attribute), [segments](#segment), and [features](#feature).

By being declarative, it means that we are only declaring (telling the system) what outcome we desire, and then Featurevisor takes care of everything else for us.

These concepts can help you understand more about it:

- [Infrastructure as Code (IaC)](/docs/concepts/infrastructure-as-code)
- [GitOps](/docs/concepts/gitops)

## Description

All Featurevisor [entities](#entity) expect descriptions, to help document what they are intended to be used for.

## Directory

A directory, also known as a folder, is a container used to organize [files](#file) and other directories within a file system.

## Double

Featurevisor allows `double` as a data type for [variables](#variable), which allows you to have numbers with decimal places.

Learn more about its usage [here](/docs/features/#double).

## Entity

All the building blocks of Featurevisor are called entities, which are:

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

Evaluation is the process how Featurevisor SDKs compute the values of feature's own:

- enabled/disabled status
- its [variations](#variation), and
- [variables](#variable)

against a given [context](#context).

Learn more in [SDKs](/docs/sdks/) page.

## Event

Featurevisor [SDKs](#sdk) emit several different kinds of events for [applications](#application) to hook into depending on their use cases.

Learn more here:

- [Readiness](/docs/sdks/javascript/#asynchronous)
- [Activation](/docs/sdks/javascript/#activation)
- [Events](/docs/sdks/javascript/#events)
- [Logging](/docs/sdks/javascript/#logging)

## Experiment

Experiments can be of two types in Featurevisor:

- [A/B test](#a-b-test)
- [Multivariate tests](#multivariate-test)

Even though they are experiments in traditional terms, in Featurevisor everything is defined as a feature (either it's a simple feature with enabled/disabled status, or one with also [variations](#variation)).

Learn more about them in [Experiments](/docs/use-cases/experiments) guide.

## Expose

Exposing a feature in a specific [environment](#environment) is an advanced technique which is very handy when you are migrating away from another feature management tool to Featurevisor.

There might be cases where you want Featurevisor to be used in [staging](#staging) environment for specific features first, while still using the previous existing feature management tool in [production](#production).

Learn more how exposing works on a per environment basis [here](/docs/features/#expose).

## Feature

Either you want a:

- simple feature flag with enabled/disabled status, or
- one with [variations](#variation) to be treated as an [experiment](#experiment), or
- one with [variables](#variable) for more complex configuration

...everything is defined as a feature in Featurevisor.

A feature is the core building block, and you can learn more about its anatomy [here](/docs/features).

## Fetch

Fetching is the process of how Featurevisor [SDKs](#sdk) pull in the latest datafiles over the network which packs all the configuration for evaluating all your features in your application against provided contexts.

## File

A file is a container in a computer system for storing information, often in the form of text, images, audio, or software.

Featurevisor [entities](#entity) are all stored as files in their own [directories](#directory).

## Flag

These terms are often used interchangeably:

- [Feature](#feature)
- Feature flag
- Flag

## Force

While you may set up all your [rules](#rule) inside a feature targeting various [segments](#segment), you may want to override them all for certain users, especially when you wish to test things out yourself before affecting your real users in [production](#production).

This guide for testing in production will explain the use case well [here](/docs/use-cases/testing-in-production).

The `force` API docs can be found [here](/docs/features/#force).

## Git

Git is a distributed version control system that allows multiple people to work on a project at the same time without overwriting each other's changes. It tracks changes to files in a [repository](#repository) (think a project) so you can see what was changed, who changed it, and why.

Git is widely used in software development for source code management. With Featurevisor, all feature configurations are stored in a Git repository that we call our Featurevisor project.

## GitHub

GitHub is a web-based hosting service for version control using Git. It provides a platform for collaboration, allowing developers to contribute to projects, fork repositories, submit [pull requests](#pull-request), and manage versioned files.

## GitHub Actions

GitHub Actions is a CI/CD (Continuous Integration/Continuous Deployment) service provided by [GitHub](#github). It allows developers to automate, customize, and execute their software development workflows right in their GitHub repository.

Actions can be used to build, test, and [deploy](#deployment) applications, manage issues, publish packages, and much more. Workflows are defined using [YAML](#yaml) syntax and can be triggered by various GitHub events such as push, [pull requests](#pull-request) or issue creation.

## GitOps

In its simplest form GitOps means doing operations using [Git](#git).

Read our [GitOps](/docs/concepts/gitops) guide for more info.

## Group

When you wish to run mutually exclusive [experiments](#experiment), meaning the same user should be exposed to two or more overlapping experiments, groups come in handy.

Learn more about groups [here](/docs/groups).

## Hash

Featurevisor [SDKs]](#sdk) rely on in-memory hashing algorithm making sure same user is bucketed into same feature and variation based on rollout rules consistently across all devices and sessions.

Learn more about it in our guide for [bucketing](/docs/bucketing).

## Instance

Refers to the instance of the [SDK](#sdk), once initialized with your desired configuration parameters.

Learn more about SDK usage [here](/docs/sdks/javascript).

## Integer

If you wish to define [variables](#variable) which are whole numbers (without decimal places), then `integer` type is what you need.

Learn more about integer type's usage in variables [here](/docs/features/#integer).

## Interval

Featurevisor [SDKs](#sdk) allow refreshing datafiles, and one of the techniques can be interval based, meaning it can keep refreshing the [datafile](#datafile) every X number of seconds.

You can learn more about refreshing in SDKs [here](/docs/sdks/javascript/#refreshing).

## JavaScript

JavaScript is a high-level, interpreted programming language primarily used for enhancing web pages to provide a more interactive user experience. It's one of the core technologies of the web, alongside HTML and CSS.

Featurevisor CLI is written in JavaScript, targeting Node.js runtime.

But the JavaScript SDK is universal, meaning it works in both browsers and in Node.js.

## JSON

JSON (JavaScript Object Notation) is a lightweight data-interchange format that is easy for humans to read and write and easy for machines to parse and generate.

It's often used to transmit data between a server and an application.

From Featurevisor's perspective, it builds [datafiles](#datafile) (which are JSON files). These datafiles are then [fetched](#fetch) and consumed by applications using Featurevisor [SDKs](#sdk) in various different programming languages.

## Key

Keys may mean the name of your Featurevisor entities like [attribute](#attribute), [segments](#segment), and [features](#feature). The names are based on their file names without their extensions (like `.yml`, or `.json`).

When [variables](/docs/features/#variables) are defined inside a feature, they are also given unique keys within their features.

As for [rules](/docs/features/#rules) within [environments](#environment), they also have their own keys.

## Level

Refers to the different levels of [logging](#logging), like:

- `log`
- `info`
- `warn`
- `error`

## Lint

Entities are expressed declaratively in Featurevisor, primarily as [YAML](#yaml) or [JSON](#json) files.

To make sure they do not contain any human introduced mistakes, linting takes care of finding those issues early (if any) before proceeding with [building datafiles](/docs/building-datafiles).

Learn more about linting [here](/docs/linting).

## Logging

Featurevisor [SDKs](#sdk) allow logging various different levels of messages which can be used for tracking, analyzing performance, troubleshooting, understanding how [evaluations](#evaluation) are done and more.

Learn more about logging [here](/docs/sdks/javascript/#logging).

## Merge

When you send a [Pull Request](#pull-request) making changes to the configuration of your desired Featurevisor entities, you then proceed with merging it to finally apply the changes so it impacts your applications.

## Multivariate Test

Traditionally with A/B tests, you test a single [variation](#variation) change.

With multivariate tests, multiple [variables](#variable) are modified for testing a hypothesis.

Learn about it more depth in our [Experiments](/docs/use-cases/experiments) guide.

## Mutually Exclusive

When you do not wish to expose a single user to more than one experiment at a time from your list of predefined experiments.

Featurevisor allows you to achieve that via [Groups](/docs/groups).

## Name

The word **name** may often be used interchangeably with **key**.

Like your [feature](#feature) name or key.

## Native apps

Usually means applications which are built specifically for a platform, like iOS and Android apps.

## Node.js

JavaScript the programming language was originally introduced to work in browsers only. With the introduction of Node.js, which is an open-source, cross-platform, JavaScript runtime environment, allowed executing code written in this language outside of a web browser as well.

This includes server-side and [command line applications](#cli).

Featurevisor CLI is a Node.js package allowing you to use it via command line in Terminal.

While Featurevisor JavaScript SDK works in both browsers and in Node.js services.

## npm

npm is a package manager for Node.js.

Like millions of other open source packages, Featurevisor is also distributed via npm.

As application builders and users of Featurevisor, we download Featurevisor [packages](#package) via npm.

## Object

Featurevisor allows defining flat objects (key/value pairs of data) as [variables](#variable).

Learn more about its usage [here](/docs/features/#object).

## Operator

When we define [segments](#segment), it will contain various different [conditions](#condition). And each of those conditions will use operators like `equals`, `notEquals`, and more against your desired values.

See full list of supported operators [here](/docs/segments/#operators).

## Override

Variations and variables inside features can be overridden in few different ways allowing more flexibility as our features grow more complex.

Learn more about them here:

- [Overriding variation](/docs/features/#overriding-variation)
- [Overriding variables](/docs/features/#overriding-variables)

## Package

Featurevisor as a tool is a set of various different packages, which are distributed via package managers targeting different programming languages.

The [CLI](#cli) is written in [JavaScript](#javascript) targeting [Node.js](#nodejs) runtime, which is distributed via [npm](#npm).

## Parser

By default, Featurevisor expects all [entities](#entity) will be defined as [YAML](#yaml) files. With native support of choosing [JSON](#json) as well.

Next to that, the project configuration API allows you to bring in your own custom parser for different formats like TOML, XML, etc.

Learn more about them here:

- [Custom parsers](/docs/advanced/custom-parsers)
- [Project configuration](/docs/configuration)

## Percentage

Not all releases of your features should be a big bang release affecting all your users. You may want to roll it out gradually, starting with 5%, then 10%, then 20%, and all the way up to 100% as you gain more confidence.

These percentages are defined in your rollout [rules](/docs/features/#rules) inside features.

Learn more about gradual rollout and progressive delivery [here](/docs/use-cases/progressive-delivery).

## Pretty

When machines deal with JSON files, they usually are in their most compressed form to save disk space and network bandwidth. When compressed, they also affect readability for humans negatively.

For debugging (investigating) purposes, there's an option in Featurevisor's project configuration to allow for [pretty datafiles](/docs/configuration/#pretty-datafile) and [pretty state files](/docs/configuration/#pretty-state) improving readability for humans.

## Production

Refers to the production [environment](#environment), where your application(s) are deployed to affecting your real users.

## Project

Your Featurevisor project, which is usually a single independent Git [repository](#repository).

See quick start guide on how to create a new project [here](/docs/quick-start).

## Pull Request

A pull request is a feature in version control systems like [Git](#git), and platforms like [GitHub](#github), that allows developers to propose changes to a codebase.

It's a request to "pull" your changes into the main project. Pull requests show content differences, facilitate discussions, code [review](#review), and can be integrated with other testing and [CI/CD](#ci-cd) tools before the changes are [merged](#merge) into the main branch.

## Push

In the context of [Git](#git), "push" is a command used to upload local [repository](#repository) content to a remote repository.

After [committing](#commit) changes locally, you "push" them to the remote repository to share your changes with others and synchronize your local repository with the remote. It's an essential command for collaborative work in Git.

## QA

Many organizations have Quality Assurance (QA) teams, making sure everything is working as expected before the changes of your applications are exposed to your real users, minimizing any potential risks.

## Ready

When Featurevisor SDKs are used [asynchronously](/docs/sdks/javascript/#initialization), we are delegating the responsibility of [fetching](#fetch) the [datafile](#datafile) to the SDK itself.

The fetching of datafile is an asynchronous task over the network. To know when Featurevisor SDK has successfully fetched the datafile, we rely on its readiness events.

Learn more about their usage here:

- [onReady option](/docs/sdks/javascript/#asynchronous)
- [isReady method](/docs/sdks/javascript/#listening-to-events)
- [onReady method](/docs/sdks/javascript/#listening-to-events)

## Refresh

Featurevisor SDKs allow refreshing [datafile](#datafile) content without having to restart or reload your whole [application](#application).

Learn more about refreshing [here](/docs/sdks/javascript/#refreshing).

## Repository

A repository, often abbreviated as "repo", is a storage location for software packages. It contains all files and directories associated with a project.

From Featurevisor's perspective, a single project is usually its own independent [Git](#git) repository consisting of files which are defining various entities like [attributes](#attribute), [segments](#segment), and [features](#feature).

## Review

When we send [Pull Requests](#pull-request), the idea is to get it reviewed by our peers who may either [approve](#approval), reject, or request for more changes.

## Revision

Each successful [build](#build) of Featurevisor [datafiles](#datafile) produce a new revision number. This is in integer format (a whole number with no decimal places), and is incremented by 1 from previous build's revision.

This revision number is present in all generated datafiles, so applications will know which revision they are using with provided SDKs.

Learn more about it:

- [Building datafiles](/docs/building-datafiles)
- [State files](/docs/state-files)

## Required

Featurevisor supports defining certain features as dependencies for a particular feature.

Learn more about it here:

- [Managing feature dependencies](/docs/use-cases/dependencies)
- [Defining dependencies in features](/docs/features/#required)

## Rule

Rollout rules are defined per [environment](#environment) for each individual [features](#feature).

Learn more about rules [here](/docs/features/#rules).

## Schema

When [variables](#variable) are defined inside a feature, they must also provide their own schema to let Featurevisor know more about it.

Learn more about variables schema [here](/docs/features/#variables).

## Schema version

Generated [datafiles](#datafile) follow a schema version.

Featurevisor started with the schema version of 1, and a new schema version 2 is in the works.

See how you can build datafiles against a more optimized schema version [here](/docs/building-datafiles/#schema-v2).

## SDK

SDK stands for Software Development Kit.

Featurevisor comes with [SDKs](/docs/sdks) in a few different programming languages. Their purpose is to [fetch](#fetch) [datafiles](#datafile) and [evaluate](#evaluation) values in your applications as you need them.

## Segment

Segments are groups of [conditions](#condition), which are then used in the rollout [rules](#rule) of your features.

Learn more about segments:

- [Defining segments](/docs/segments)
- [Using segments in feature rules](/docs/features/#segments)

## Site

Featurevisor is also capable of generating a static read-only website based on all [entity](#entity) definitions as found in your project [repository](#repository).

This generated site, once hosted, serves as a dashboard for your team and organization for understanding what's the latest state of configuration everywhere.

Learn more about it [here](/docs/site).

## Slot

When defining mutually exclusive [experiments](#experiment) (think [features](#feature) in Featurevisor) in a [group](#group), each feature is put in a slot so they never overlap.

Learn more about usage of slots in groups [here](/docs/groups).

## Staging

Similar to [production](#production), staging is a common [environment](#environment) in software engineering culture.

This environment is meant to serve for testing things out internally within the team, before deploying the changes to production where your real users are.

## State files

Because there's no real database involved in Featurevisor, the tool uses [Git](#git) for storing and keeping track of all traffic allocation information against rollout rules in features, and incremental revision numbers.

Learn more about them and their usage here:

- [State files](/docs/state-files)
- [Deployment](/docs/deployment)

## Status

A status check for a [commit](#commit) is a process in version control systems like [Git](#git), and platforms like [GitHub](#github), that verifies the commit against certain criteria before it's merged into the main [branch](#branch).

This can include running automated tests, checking for code style adherence, verifying the commit message format, and more. Status checks help maintain code quality and prevent introducing errors into the main codebase. They are often integrated into the [pull request](#pull-request) process.

## Sticky

Applications may often decide to make certain [evaluations](#evaluation) sticky (not take fetched [datafile](#datafile) into account) for specific users against certain [features](#feature) for the lifecycle of the [SDK](#sdk).

You can more about how Featurevisor SDKs allow that [here](/docs/sdks/javascript/#stickiness).

## String

String is a data type that's used for texts. It is one among many other data types that's supported in [variables](#variable).

Learn more about it [here](/docs/features/#string).

## Tag

Your organization may have a single Featurevisor [project](#project), in a single Git repository, containing several hundreds or thousands of [features](#feature).

But there might be 10 or more separate consumers (applications), and they each may want to fetch [datafiles](#datafile) containing only a subset of all the features found in your project.

This is where tagging comes in handy. Each feature can be tagged accordingly, and datafile generator will take care of building tag specific files for your applications to consume. Each application is then able to fetch only the features they need and nothing more or less.

Learn more about it here:

- [Building datafiles](/docs/building-datafiles)
- [Tags in features](/docs/features/#tags)

## Terminal

A Terminal, also known as a command line or console, is a text-based interface used to interact with an operating system. Users can input commands to perform operations, navigate the file system, and run scripts or applications.

If you are using macOS, then this is your Terminal app.

## Testing

Unlike any other feature management tools, Featurevisor allows your to test your [segments](#segment) and [features](#feature) against your expectations.

This is similar to "unit testing" in regular programming.

Just like how features and segments are defined declaratively, you can also define your tests for them declaratively, and Featurevisor will test everything for you.

If some tests are failing, it means something is wrong somewhere and we can fix it early before applying our changes.

Learn more about it [here](/docs/testing).

## Tracking

Experiments are of no use if we are not tracking anything.

Featurevisor SDKs emit [activation](#activation) events, which can be handled and then tracked accordingly using your favourite analytics service.

Here are some guides regarding tracking activation events:

- [Activating features](/docs/sdks/javascript/#activation)
- [Tracking with Google Analytics / Tag Manager](/docs/tracking/google-analytics)

## Usage

Sometimes we create [segments](#segment) and [attributes](#attribute), and we can't always tell quickly where they are actively being used.

Featurevisor CLI brings in some goodies to help find their usage, and also entities which are not used anywhere so you can take actions to clean them up.

Learn more about it [here](/docs/cli/#find-usage).

## Value

A value can be anything. This paragraph that you are reading can itself be a value.

In terms of Featurevisor, a value can be the [evaluated](#evaluation) output of a:

- feature's own enabled/disabled status
- feature's variation
- feature's variable

See how SDKs evaluate values [here](/docs/sdks/).

## Variable

Variables are key/value pairs of data that be defined inside individual features.

Learn more about their usage here:

- [Defining variables in features](/docs/features/#variables)
- [Evaluating variables using SDKs](/docs/sdks/javascript/#getting-variables)
- [Remote configuration](/docs/use-cases/remote-configuration)

## Variation

Defining variations in features allow you to turn them into [A/B](#a-b-test) or [Multivariate test](#multivariate-test) experiments.

Learn more about their usage here:

- [Defining variations in features](/docs/features/#variations)
- [Evaluating variations using SDKS](/docs/sdks/javascript/#getting-variations)

## Weight

When we define [variations](#variation) in our features, we also have to provide weights for each variation for splitting their traffic distribution.

If you have only two variations, it could be a 50-50 split or a 20-80 split, depending on your needs. It's totally up to do you define them.

It's important to understand that weights of variations are something different than rule [percentages](#percentage), because rules are affecting the entire [feature](#feature).

Learn more about variations [here](/docs/features/#variations).

## YAML

YAML, which stands for "YAML Ain't Markup Language".

It's a human-friendly data serialization standard and is often used for configuration files and in applications where data is being stored or transmitted.

YAML is designed to be readable and easily editable by humans, and it allows complex data structures to be expressed in a natural and minimal syntax.
