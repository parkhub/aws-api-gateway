# aws-api-gateway

The complete AWS API Gateway Framework, powered by [Serverless Components](https://github.com/serverless/components).

## Features

- Create & manage new API Gateway REST APIs with very simple configuration.
- Extend Existing API Gateway REST APIs without disrupting other services.
- Integrate with AWS Lambda via the [aws-lambda component](https://github.com/serverless-components/aws-lambda)
- Authorize requests with AWS Lambda authorizers

(coming soon)
- Serverless custom endpoints
- HTTP API endpoints (websockets and apigatewayv2 endpoints)
- apikey management
- domain name management

## Options

You have two sets of options, base options that apply to the whole gateway and per endpoint options. The base options appear under the inputs field of the base object below, all are optional:
  ```yaml
  restApi:
    component: "@parkhub/aws-api-gateway"
    inputs:
      name: API Name
      id: ID of existing api
      description: Description of API purpose
      minimumCompressionSize: 1048575       # Set size that gateway starts compressing return size
      binaryMediaTypes:                     # Extra media types to add to gateway
        - multipart/form-data
      deploymentDescription: description
      stage: development
      mode: update mode (merge | overwrite)
      cors: true                            # Setup Cross-Origin
  ```
  
  The above default as:
  ```js
{
  name: 'Test API',
  region: 'us-east-1',
  description: 'Public API',
  minimumCompressionSize: 1048576,
  binaryMediaTypes: ['multipart/form-data'],
  deploymentDescription: new Date().toISOString(),
  mode: 'overwrite'
}
  ```
  
Per Endpoint options are set on each of the elements of the endpoint array. Currently two types of enpoints are accepted custom http and lambda proxy. You use http by specifying a `URI` to hit and lambda by specifying a `function`. Function trumps url.
```yaml
restApi:
  component: "@parkhub/aws-api-gateway"
  inputs:
    description: Serverless REST API
    endpoints:
      - path: /users
        method: POST
        function: Function Name
        authorizer: Authorizer Name
      - path: /users
        method: GET
        URI: http://example.com/users
```

  - path: gateway path
  - method: gateway method
  - function: lambda proxy function name (required if no URI)
  - URI: uri of the service endpoint to hit
  - authorizer: Gateway authorizer name
  - validator: gateway input validator (0: Body, 1:BodyAndParams, 2: Params, def: NONE)
  - params: input parameters to setup
    - path: path is setup from root path, param path is used for documentation only
    - querystrings: takes either {key:bool} for simple required/not, {key:obj} for documentation, and {key:string} for hardcoding a value
      - key:
        - value: Bool (required/not)
        - type: documenting type
        - def:  documenting default
        - example:  documenting example
        - description:  documenting description
  - headers: takes the same set of values as params
   - keys:
    - value
    - description
 - template: string velocity code for input transformation
 - responses: array of objects
    - code: http return code
    - model: json schema for validating return
    - template: velocity code for output transformation
  
## Recommendations
Use @parkhub/config https://github.com/parkhub/config to setup environment and stage variables and handle them in the configuration. With the config endpoint you can pass flags with defaults, import other yaml files and setup variables that can use eachother as variables to make env changes simple and automatic.
```yaml
config:
  component: "@parkhub/config"
  inputs:
    flags:
      stage: dev
    files:
      outputModels: "./outputModels.yml"
      inputModels: "./inputModels.yml"
    environment:
      HOST: (custom.(flags.stage)-host)
    custom:
      dev-host: http://dev.example.com
      qa-host: http://qa.example.com
```

For reusable configurations use yaml pointers and other conviences. Declare them at the top of the file and reference them later.
```yaml
headers: &headers
  Content-type: application/json
  
*headers
```
# Example
## Table of Contents

1. [Install](#1-install)
2. [Create](#2-create)
3. [Configure](#3-configure)
4. [Deploy](#4-deploy)

### 1. Install

```shell
$ npm install -g serverless
```

### 2. Create

Just create the following simple boilerplate:

```shell
$ touch serverless.yml # more info in the "Configure" section below
$ touch index.js       # your lambda code
$ touch .env           # your AWS api keys
```

```
# .env
AWS_ACCESS_KEY_ID=XXX
AWS_SECRET_ACCESS_KEY=XXX
```

the `index.js` file should look something like this:


```js

module.exports.createUser = async (e) => {
  return {
    statusCode: 200,
    body: 'Created User'
  }
}

module.exports.getUsers = async (e) => {
  return {
    statusCode: 200,
    body: 'Got Users'
  }
}

module.exports.auth = async (event, context) => {
  return {
    principalId: 'user',
    policyDocument: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: 'execute-api:Invoke',
          Effect: 'Allow',
          Resource: event.methodArn
        }
      ]
    }
  }
}

```

Keep reading for info on how to set up the `serverless.yml` file.

### 3. Configure
You can configure the component to either create a new REST API from scratch, or extend an existing one.

#### Creating REST APIs
You can create new REST APIs by specifying the endpoints you'd like to create, and optionally passing a name and description for your new REST API. You may also choose between a lambda proxy or http proxy integration by using the function or proxyURI field respectively. The function field will override the proxyURI field.

```yml
# serverless.yml

createUser:
  component: "@serverless/aws-lambda"
  inputs:
    code: ./code
    handler: index.createUser
getUsers:
  component: "@serverless/aws-lambda"
  inputs:
    code: ./code
    handler: index.getUsers
auth:
  component: "@serverless/aws-lambda"
  inputs:
    code: ./code
    handler: index.auth

restApi:
  component: "@serverless/aws-api-gateway"
  inputs:
    description: Serverless REST API
    endpoints:
      - path: /users
        method: POST
        function: ${createUser.name}
        authorizer: ${auth.name}
      - path: /users
        method: GET
        function: ${getUsers.arn}
        authorizer: ${auth.name}
      - path: /users
        method: PUT
        proxyURI: https://example.com/users
        authorizer: ${auth.arn}
```

#### Extending REST APIs
You can extend existing REST APIs by specifying the REST API ID. This will **only** create, remove & manage the specified endpoints without removing or disrupting other endpoints.

```yml
# serverless.yml

createUser:
  component: "@serverless/aws-lambda"
  inputs:
    code: ./code
    handler: index.createUser
getUsers:
  component: "@serverless/aws-lambda"
  inputs:
    code: ./code
    handler: index.getUsers

restApi:
  component: "@serverless/aws-api-gateway"
  inputs:
    id: qwertyuiop # specify the REST API ID you'd like to extend
    endpoints:
      - path: /users
        method: POST
        function: ${createUser.name}
      - path: /users
        method: GET
        function: ${getUsers.name}
```

### 4. Deploy

```shell
$ serverless
```

&nbsp;

### New to Components?

Checkout the [Serverless Components](https://github.com/serverless/components) repo for more information.
