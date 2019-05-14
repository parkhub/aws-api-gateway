const AWS = require('aws-sdk')
const apig = new AWS.APIGateway()

const getEndpointId = async (restApiId, endpoint) => {
  const existingEndpoints = (await apig
    .getResources({
      restApiId: restApiId
    })
    .promise()).items

  const endpointFound = existingEndpoints.find(
    (existingEndpoint) => existingEndpoint.path === endpoint
  )

  return endpointFound ? endpointFound.id : null
}

const methodExists = async (restApiId, endpoint, method) => {
  const resourceId = await getEndpointId(restApiId, endpoint)

  if (!resourceId) {
    return false
  }

  const params = {
    httpMethod: method.toUpperCase(),
    resourceId,
    restApiId
  }

  try {
    await apig.getMethod(params).promise()
    return true
  } catch (e) {
    if (e.code === 'NotFoundException') {
      return false
    }
  }
}

const createMethod = async (restApiId, endpoint, method, lambdaArn, roleArn) => {
  const resourceId = await getEndpointId(restApiId, endpoint)

  const params = {
    authorizationType: 'NONE',
    httpMethod: method,
    resourceId,
    restApiId: restApiId,
    apiKeyRequired: false
  }

  // todo dont overwrite

  await apig.putMethod(params).promise()

  const integrationParams = {
    httpMethod: method,
    resourceId,
    restApiId,
    type: 'AWS_PROXY',
    credentials: roleArn,
    integrationHttpMethod: 'POST',
    uri: lambdaArn
  }

  await apig.putIntegration(integrationParams).promise()
}

const createEndpoint = async (restApiId, endpoint) => {
  if (!endpoint.startsWith('/')) {
    endpoint = `/${endpoint}`
  }
  if (endpoint.endsWith('/')) {
    endpoint = endpoint.substring(0, endpoint.length - 1)
  }

  const existingEndpoints = (await apig
    .getResources({
      restApiId: restApiId
    })
    .promise()).items

  const endpointExists = existingEndpoints.find(
    (existingEndpoint) => existingEndpoint.path === endpoint
  )

  if (endpointExists) {
    return endpointExists.id
  }

  const endpointParts = endpoint.split('/')
  const pathPart = endpointParts.pop()
  const parentEndpoint = endpointParts.join('/')

  let parentId
  if (parentEndpoint === '') {
    parentId = existingEndpoints.find((existingEndpoint) => existingEndpoint.path === '/').id
  } else {
    parentId = await createEndpoint(restApiId, parentEndpoint)
  }

  const params = {
    pathPart,
    parentId,
    restApiId
  }

  const createdEndpoint = await apig.createResource(params).promise()

  return createdEndpoint.id
}

// createEndpoint('hh9s891g8d', 'posts/authorize/again/hello/one')
methodExists('5mz0wfkj2i', '/faker', 'post').then((res) => console.log(res))
