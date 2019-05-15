const AWS = require('aws-sdk')
const { mergeDeepRight } = require('ramda')

const parseEndpoint = (endpoint) => {
  endpoint = endpoint.trim()
  const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ANY']
  const method = endpoint.split(' ')[0].toUpperCase()
  let path = endpoint.split(' ')[1]

  if (!endpoint || !validMethods.includes(method) || !path || path === '') {
    throw Error(`invalid endpoint "${endpoint}"`)
  }

  if (path !== '/') {
    if (!path.startsWith('/')) {
      path = `/${path}`
    }
    if (path.endsWith('/')) {
      path = path.substring(0, path.length - 1)
    }
  }

  return {
    raw: `${method} ${path}`,
    path,
    method
  }
}

const parseEndpoints = (endpoints) => endpoints.map((endpoint) => parseEndpoint(endpoint))

const apiExists = async ({ apig, apiId }) => {
  if (!apiId) {
    return false
  }

  try {
    await apig.getRestApi({ restApiId: apiId }).promise()
    return true
  } catch (e) {
    if (e.code === 'NotFoundException') {
      return false
    }
    throw Error(e)
  }
}

const createApi = async ({ apig, name, description }) => {
  const api = await apig
    .createRestApi({
      name,
      description
    })
    .promise()

  return api.id
}

const getPathId = async ({ apig, apiId, endpoint }) => {
  const existingEndpoints = (await apig
    .getResources({
      restApiId: apiId
    })
    .promise()).items

  if (!endpoint) {
    const rootResourceId = existingEndpoints.find(
      (existingEndpoint) => existingEndpoint.path === '/'
    ).id
    return rootResourceId
  }

  const endpointFound = existingEndpoints.find(
    (existingEndpoint) => existingEndpoint.path === endpoint.path
  )

  return endpointFound ? endpointFound.id : null
}

const endpointExists = async ({ apig, apiId, endpoint }) => {
  const resourceId = await getPathId({ apig, apiId, endpoint })

  if (!resourceId) {
    return false
  }

  const params = {
    httpMethod: endpoint.method,
    resourceId,
    restApiId: apiId
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

const validateEndpointObject = (endpoint) => {
  const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'ANY']

  if (typeof endpoint !== 'object') {
    throw Error('endpoint must be an object')
  }

  if (!endpoint.method) {
    throw Error(`missing method property for endpoint "${JSON.stringify(endpoint)}"`)
  }

  if (endpoint.path === '') {
    throw Error(
      `endpoint path cannot be an empty string for endpoint "${JSON.stringify(endpoint)}"`
    )
  }

  if (!endpoint.path) {
    throw Error(`missing path property for endpoint "${JSON.stringify(endpoint)}"`)
  }

  if (typeof endpoint.method !== 'string' || typeof endpoint.path !== 'string') {
    throw Error(`invalid endpoint "${JSON.stringify(endpoint)}"`)
  }

  if (!validMethods.includes(endpoint.method.toUpperCase())) {
    throw Error(`invalid method for endpoint "${JSON.stringify(endpoint)}"`)
  }

  if (endpoint.path !== '/') {
    if (!endpoint.path.startsWith('/')) {
      endpoint.path = `/${endpoint.path}`
    }
    if (endpoint.path.endsWith('/')) {
      endpoint.path = endpoint.path.substring(0, endpoint.path.length - 1)
    }
  }

  const validatedEndpoint = {
    raw: `${endpoint.method.toUpperCase()} ${endpoint.path}`,
    path: endpoint.path,
    method: endpoint.method.toUpperCase()
  }

  return mergeDeepRight(endpoint, validatedEndpoint)
}

const validateEndpoint = async ({ apig, apiId, endpoint, state }) => {
  const validatedEndpoint = validateEndpointObject(endpoint)

  if (await endpointExists({ apig, apiId, endpoint: validatedEndpoint })) {
    if (!state.endpoints || !state.endpoints.find((e) => e.raw === validatedEndpoint.raw)) {
      throw Error(`endpoint ${validatedEndpoint.raw} already exists in provider`)
    }
  }

  return validatedEndpoint
}

const validateEndpoints = async ({ apig, apiId, endpoints, state }) => {
  const promises = []

  for (const endpoint of endpoints) {
    promises.push(validateEndpoint({ apig, apiId, endpoint, state }))
  }

  return Promise.all(promises)
}

const createPath = async ({ apig, apiId, endpoint }) => {
  const pathId = await getPathId({ apig, apiId, endpoint })

  if (pathId) {
    return pathId
  }

  const pathParts = endpoint.path.split('/')
  const pathPart = pathParts.pop()
  const parentEndpoint = { path: pathParts.join('/') }

  let parentId
  if (parentEndpoint.path === '') {
    parentId = await getPathId({ apig, apiId })
  } else {
    parentId = await createPath({ apig, apiId, endpoint: parentEndpoint })
  }

  const params = {
    pathPart,
    parentId,
    restApiId: apiId
  }

  const createdPath = await apig.createResource(params).promise()

  return createdPath.id
}

const createPaths = async ({ apig, apiId, endpoints }) => {
  const createdEndpoints = []

  for (const endpoint of endpoints) {
    endpoint.id = await createPath({ apig, apiId, endpoint })
    createdEndpoints.push(endpoint)
  }

  return createdEndpoints
}

const createMethod = async ({ apig, apiId, endpoint }) => {
  const params = {
    authorizationType: 'NONE',
    httpMethod: endpoint.method,
    resourceId: endpoint.id,
    restApiId: apiId,
    apiKeyRequired: false
  }

  try {
    await apig.putMethod(params).promise()
  } catch (e) {
    if (e.code !== 'ConflictException') {
      throw Error(e)
    }
  }
}

const createMethods = async ({ apig, apiId, endpoints }) => {
  const promises = []

  for (const endpoint of endpoints) {
    promises.push(createMethod({ apig, apiId, endpoint }))
  }

  await Promise.all(promises)

  return endpoints
}

const createIntegration = async ({ apig, lambda, apiId, endpoint }) => {
  const functionName = endpoint.function.split(':')[6]
  const accountId = endpoint.function.split(':')[4]
  const region = endpoint.function.split(':')[3] // todo what if the lambda in another region?

  const integrationParams = {
    httpMethod: endpoint.method,
    resourceId: endpoint.id,
    restApiId: apiId,
    type: 'AWS_PROXY',
    integrationHttpMethod: 'POST',
    uri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${
      endpoint.function
    }/invocations`
  }

  const res = await apig.putIntegration(integrationParams).promise()

  const permissionsParams = {
    Action: 'lambda:InvokeFunction',
    FunctionName: functionName,
    Principal: 'apigateway.amazonaws.com',
    SourceArn: `arn:aws:execute-api:${region}:${accountId}:${apiId}/*/*`,
    StatementId: `${functionName}-http`
  }

  try {
    await lambda.addPermission(permissionsParams).promise()
  } catch (e) {
    if (e.code !== 'ResourceConflictException') {
      throw e
    }
  }

  return res
}

const createIntegrations = async ({ apig, lambda, apiId, endpoints }) => {
  const promises = []

  for (const endpoint of endpoints) {
    promises.push(createIntegration({ apig, lambda, apiId, endpoint }))
  }

  await Promise.all(promises)

  return endpoints
}

const createDeployment = async ({ apig, apiId, stage }) => {
  const deployment = await apig.createDeployment({ restApiId: apiId }).promise()

  const stageParams = {
    deploymentId: deployment.id,
    restApiId: apiId,
    stageName: stage
  }

  // todo add update stage functionality
  try {
    await apig.createStage(stageParams).promise()
  } catch (e) {
    if (e.code !== 'ConflictException') {
      throw Error(e)
    }
  }

  return deployment.id
}

// const run = async () => {
//   const apig = new AWS.APIGateway()
//   const apiId = 'hh9s891g8d'
//
//   const endpoint = {
//     path: 'users/',
//     method: 'any'
//   }
//
//   const endpoints = [
//     {
//       path: 'posts/any',
//       method: 'get',
//       function: 'abc'
//     },
//     {
//       path: 'posts/',
//       method: 'post',
//       function: 'abc'
//     }
//   ]
//
//   const validatedEndpoint = await validateEndpoints({ apig, apiId, endpoints, state: {} })
//
//   console.log(validatedEndpoint)
// }
//
// run()

module.exports = {
  validateEndpointObject,
  validateEndpoint,
  validateEndpoints,
  endpointExists,
  apiExists,
  createApi,
  getPathId,
  createPath,
  createPaths,
  createMethod,
  createMethods,
  createIntegration,
  createIntegrations,
  createDeployment
}
