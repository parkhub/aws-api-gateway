# AWS ApiGateway

Instantly deploy REST APIs on AWS API Gateway with very simple configuration using [Serverless Components].

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
```


### 3. Configure

```yml
# serverless.yml

name: my-api

myLambda:
  component: "@serverless/aws-lambda"
  inputs:
    name: ${name}-lambda
    code: ./code
    handler: index.handler

myApiGateway:
  component: "@serverless/aws-api-gateway"
  inputs:
    name: ${name}-gateway
    routes:
      /foo:
        get:
          function: ${comp:myLambda.arn} # pass in the arn output property from the lambda component
          cors: true
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
