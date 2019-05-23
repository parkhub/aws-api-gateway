# aws-api-gateway

The complete AWS API Gateway Framework, powered by [Serverless Components](https://github.com/serverless/components).

## Features

- Create & manage new API Gateway REST APIs with very simple configuration.
- Extend Existing API Gateway REST APIs without disrupting other services.
- Integrate with AWS Lambda via the [aws-lambda component](https://github.com/serverless-components/aws-lambda)
- Authorize requests with AWS Lambda authorizers (coming soon)
- Create proxy endpoints for any URL with 3 lines of code (coming soon)
- Create mock endpoints by specifying the object you'd like to return (coming soon)
- Debug API Gateway requests Via CloudWatch Logs (coming soon)
- Protect your API with API Keys (coming soon)
- Add usage plans to your APIs (coming soon)
- Configure throttling & rate limits (coming soon)
- Trace requests with AWS X-Ray (coming soon)

## Table of Contents

1. [Install](#1-install)
2. [Create](#2-create)
3. [Configure](#3-configure)
4. [Deploy](#4-deploy)

### 1. Install

```shell
$ npm install -g @serverless/components
```

### 2. Create

Just create the following simple boilerplate:

```shell
$ touch serverless.yml # more info in the "Configure" section below
$ touch index.js       # your lambda code
$ touch .env           # your development AWS api keys
$ touch .env.prod      # your production AWS api keys
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

```

the `.env` files are not required if you have the aws keys set globally and you want to use a single stage, but they should look like this.

```
AWS_ACCESS_KEY_ID=XXX
AWS_SECRET_ACCESS_KEY=XXX
```

Keep reading for info on how to set up the `serverless.yml` file.

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

  myApig › outputs:
  id:  'e4asreichk'
  endpoints:  [ { path: '/users',
    method: 'POST',
    function:
     'arn:aws:lambda:us-east-1:552750238291:function:rest-api-create-user',
    url:
     'https://e4asreichk.execute-api.us-east-1.amazonaws.com/dev/users',
    id: 'jkgqlqjnf2' },
  { path: '/users',
    method: 'GET',
    function:
     'arn:aws:lambda:us-east-1:552750238291:function:rest-api-get-users',
    url:
     'https://e4asreichk.execute-api.us-east-1.amazonaws.com/dev/users',
    id: 'h7zh3r' } ]


  38s › dev › rest-api › done

api (master)$

```

&nbsp;

### New to Components?

Checkout the [Serverless Components](https://github.com/serverless/components) repo for more information.
