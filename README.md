# aws-api-gateway

The complete AWS API Gateway Framework, powered by [Serverless Components](https://github.com/serverless/components).

## Features

- Create & manage new API Gateway REST APIs with very simple configuration.
- Extend Existing API Gateway REST APIs without disrupting other services.
- Integrate with AWS Lambda via the [aws-lambda component](https://github.com/serverless-components/aws-lambda)
- Authorize requests with AWS Lambda authorizers
- Create proxy endpoints for any URL with 3 lines of code
- Create mock endpoints by specifying the object you'd like to return (coming soon)
- Debug API Gateway requests Via CloudWatch Logs (coming soon)
- Protect your API with API Keys (coming soon)
- Add usage plans to your APIs (coming soon)
- Configure throttling & rate limits (coming soon)
- Trace requests with AWS X-Ray (coming soon)

## Table of Contents

1. [Install](#1-install)
2. [Configure](#3-configure)
3. [Deploy](#4-deploy)

### 1. Install

```shell
$ npm install -g serverless
```

### 2. Configure
You can configure the component to either create a new REST API from scratch, or extend an existing one.

#### Creating REST APIs
You can create new REST APIs by specifying the endpoints you'd like to create, and optionally passing a name 
and description for your new REST API. You may also choose between a lambda proxy, or http integration by 
using the function or URI field respectively. The default api settings are: 
```json
{
  "name": "Test API",
  "region": "us-east-1",
  "description": "Public API",
  "minimumCompressionSize": 1048576,
  "binaryMediaTypes": ["multipart/form-data"],
  "deploymentDescription": "new Date().toISOString()",
  "mode": "overwrite"
}
```

The following is an example with all available options:

```yml
restApi:
  component: "@parkhub/aws-api-gateway"
  inputs:
    name: Developer API
    description: Rest API
    minimumCompressionSize: 1048576
    binaryMediaTypes:
      - multipart/form-data
    deploymentDescription: "Deploying api"
    stage: dev
    cors: true
    mode: merge
    endpoints:
      - path: /events
        mehtod: GET
        function: getEvents-${stage} # refer to functions with name only
        authorizer: authorize-events # custom lambda authorizer supported
        validator: 2 # validation type to use 0: Body only, 1: Body and Params, 2: Params only

      - path: /events
        method: POST
        description: Post Events
        URI: http://friendsofyoda.com/events/search
        authorizer: authorize-events  # lambda function name
        model: PostEventsInput          # Request Model

        # velocity template on request
        template: |-
           #set($root = $input.path('$.events')
           $root

        params: # sets querystrings and headers, path parameters are pulled from the path key
          querystrings:
            active: true # true or false denotes required or not
            name: 
              value: false
              description: "name of event" # also supports setting descriptions on querystrings for documentation
            type: starwars # allows hardcoded string parameters
          headers:
            Authentication: true # same logic as querystrings applies to headers

        # sets Method and Integrations responses
        responses:
          - code: 200
            model: PostEventsOutput
            # velocity template on response for specific response
            template: |-
               #set($root = $input.path('$.events')
               $root
            headers:  # automatically set by `cors: true` but you can override
              "Access-Control-Allow-Headers": "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
              "Access-Control-Allow-Methods": "'GET,OPTIONS,POST,PUT,PATCH,DELETE'",
              "Access-Control-Allow-Origin": "'*'"
         
          - *errorCodes  # These are usually redundant so the responses object is flattened which allows merging arrays

    models:  # the order you define models matter if they depend on eachother
        - title: PosteventsInput # title is required, it is used to name the model
          type: object
          description: model posteventsinput
          properties:
              here:            # its just standard json schema
                 type: string
              $ref: '#components/schema/ModelName' # oas3 routing is used for reference
```

#### Extending REST APIs
You can extend existing REST APIs by specifying the REST API ID and setting mode to 'merge'. This will not delete endpoints and models not in your serverless.yml

### 3. Deploy

```shell
$ serverless
```

&nbsp;

### New to Components?

Checkout the [Serverless Components](https://github.com/serverless/components) repo for more information.
