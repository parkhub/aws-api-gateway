# aws-api-gateway

The complete AWS API Gateway Framework, powered by [Serverless Components](https://github.com/serverless/components).

## Features

- Create & manage new API Gateway REST APIs with very simple configuration.
- Extend & manage Existing API Gateway REST APIs without disrupting other services.
- Supports AWS Lambda proxy integration
- Supports AWS Lambda Authorizers (coming soon)
- Supports proxy endpoints (coming soon)
- Supports mock endpoints (coming soon)
- Supports API Gateway Logs (coming soon)
- Supports API Keys for new & existing REST APIs (coming soon)
- Supports usage plans (coming soon)
- Supports throttling & rate limits (coming soon)
- Supports X-Ray Tracing (coming soon)

&nbsp;

1. [Install](#1-install)
2. [Create](#2-create)
3. [Configure](#3-configure)
4. [Deploy](#4-deploy)

&nbsp;


### 1. Install

```shell
$ npm install -g @serverless/components
```

### 2. Create

Just create a `serverless.yml` file

```shell
$ touch serverless.yml
$ touch .env      # your development AWS api keys
$ touch .env.prod # your production AWS api keys
```

the `.env` files are not required if you have the aws keys set globally and you want to use a single stage, but they should look like this.

```
AWS_ACCESS_KEY_ID=XXX
AWS_SECRET_ACCESS_KEY=XXX
```

### 3. Configure
You can configure the component to either create a new REST API from scratch, or extend an existing one.

#### Creating REST APIs
You can create new REST APIs by specifying the endpoints you'd like to create, and optionally passing a name and description for your new REST API.

```yml
# serverless.yml

name: rest-api

createUser:
  component: "@serverless/aws-lambda"
  inputs:
    name: ${name}-create-user
    code: ./code
    handler: index.createUser
getUsers:
  component: "@serverless/aws-lambda"
  inputs:
    name: ${name}-get-users
    code: ./code
    handler: index.getUsers

restApi:
  component: "@serverless/aws-api-gateway"
  inputs:
    name: ${name}
    description: Serverless REST API
    endpoints:
      - path: /users
        method: POST
        function: ${comp:createUser.arn}
      - path: /users
        method: GET
        function: ${comp:getUsers.arn}
```

#### Extending REST APIs
You can extend existing REST APIs by specifying the REST API ID. This will **only** create, remove & manage the specified endpoints without removing or disrupting other endpoints.

```yml
# serverless.yml

name: rest-api

createUser:
  component: "@serverless/aws-lambda"
  inputs:
    name: ${name}-create-user
    code: ./code
    handler: index.createUser
getUsers:
  component: "@serverless/aws-lambda"
  inputs:
    name: ${name}-get-users
    code: ./code
    handler: index.getUsers

restApi:
  component: "@serverless/aws-api-gateway"
  inputs:
    id: qwertyuiop # specify the REST API ID you'd like to extend
    endpoints:
      - path: /users
        method: POST
        function: ${comp:createUser.arn}
      - path: /users
        method: GET
        function: ${comp:getUsers.arn}
```

### 4. Deploy

```shell
api (master)$ components

  myLambda › outputs:
  name:  'my-api-lambda'
  description:  'AWS Lambda Component'
  memory:  512
  timeout:  10
  code:  './code'
  bucket:  undefined
  shims:  []
  handler:  'index.handler'
  runtime:  'nodejs8.10'
  env: 
  role: 
    name:  'my-api-lambda'
    arn:  'arn:aws:iam::552760238299:role/my-api-lambda'
    service:  'lambda.amazonaws.com'
    policy:  { arn: 'arn:aws:iam::aws:policy/AdministratorAccess' }
  arn:  'arn:aws:lambda:us-east-1:552760238299:function:my-api-lambda'

  myApiGateway › outputs:
  name:  'my-api-gateway'
  role: 
    name:  'my-api-gateway'
    arn:  'arn:aws:iam::552760238299:role/my-api-gateway'
    service:  'apigateway.amazonaws.com'
    policy:  { arn: 'arn:aws:iam::aws:policy/AdministratorAccess' }
  routes: 
    /foo:  { get:
   { function:
      'arn:aws:lambda:us-east-1:552760238299:function:my-api-lambda',
     cors: true } }
  id:  'z2itxmsoud'
  url:  'https://z2itxssoud.execute-api.us-east-1.amazonaws.com/dev/'
  urls:  [ 'https://z2itxssoud.execute-api.us-east-1.amazonaws.com/dev/foo' ]


  7s › dev › my-api › done

api (master)$
```

&nbsp;

### New to Components?

Checkout the [Serverless Components](https://github.com/serverless/components) repo for more information.
