# AwsApiGateway

A Serverless Component that provisions an AWS API Gateway API.

## Usage

### Simple example

```yaml
name: serverless-components

AwsLambda@0.1.3::myLambda:
  name: ${name}-lambda
  code: ./code

AwsApiGateway@0.1.2::myApiGateway:
  name: ${name}-api-gateway
  routes:
    /foo:
      post:
        function: ${comp:myLambda.arn}
```

### Detailed example

```yaml
name: serverless-components

AwsIamRole@0.1.1::myApigRole:
  name: ${name}-apig-role
  service: 'apigateway.amazonaws.com'

AwsLambda@0.1.3::myGetLambda:
  name: ${name}-get-lambda
  code: ./code

AwsLambda@0.1.3::myPutLambda:
  name: ${name}-put-lambda
  code: ./code

AwsApiGateway@0.1.2::myApiGateway:
  name: ${name}-api-gateway
  role: ${comp:myApigRole}
  routes:
    /foo:
      get:
        function: ${comp:myGetLambda.arn}
        cors: true
    /foo/bar:
      get:
        function: ${comp:myPutLambda.arn}
        cors: true
```
