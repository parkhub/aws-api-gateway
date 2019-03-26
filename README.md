# AwsApiGateway

A Serverless Component that provisions an API Gateway.

## Usage

### Simple example

```yaml
name: serverless-components

AwsLambda@0.1.1::myLambda:
  name: ${name}-lambda
  code: ./code

AwsApiGateway@0.1.0::myApiGateway:
  name: ${name}-api-gateway
  routes:
    /foo:
      post:
        function: ${comp:myLambda.arn}
```

### Complex example

```yaml
name: serverless-components

AwsIamRole@0.1.1::myApigRole:
  name: ${name}-apig-role
  service: 'apigateway.amazonaws.com'

AwsLambda@0.1.1::myLambda:
  name: ${name}-lambda
  code: ./code

AwsApiGateway@0.1.0::myApiGateway:
  name: ${name}-api-gateway
  role: ${comp:myApigRole}
  routes:
    /foo:
      post:
        function: ${comp:myLambda.arn}
    /foo/bar:
      get:
        function: ${comp:myLambda.arn}
```
