const pRetry = require('p-retry')
const { utils } = require('@serverless/core')

const retry = (fn, opts = {}) => {
  return pRetry(
    async () => {
      try {
        return await fn()
      } catch (error) {
        if (error.code !== 'TooManyRequestsException') {
          // Stop retrying and throw the error
          throw new pRetry.AbortError(error)
        }
        throw error
      }
    },
    {
      retries: 5,
      minTimeout: 1000,
      factor: 2,
      ...opts
    }
  )
}

const apiExists = async ({ apig, apiId }) => {
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

const createApi = async ({ apig, name, description, endpointTypes, config: { minimumCompressionSize, binaryMediaTypes }}) => {
  const api = await apig
    .createRestApi({
      name,
      description,
      endpointConfiguration: {
        types: endpointTypes
      },
      minimumCompressionSize,
      binaryMediaTypes
    })
    .promise()

  return api.id
}

/* Yaml does not allow merging arrays so it should be assumed they are nested,
   this way the user may use yaml anchors to reuse arrays */
function flattenArrays(obj) {
  for (var k in obj) {
    if (Array.isArray(obj[k])) {
      obj[k] = obj[k].flat(Infinity)
      flattenArrays(obj[k])
    } else if (typeof obj[k] == "object" && obj[k] !== null) {
      flattenArrays(obj[k]);
    }
  }
}

const updateApi = async({
  apig,
  apiId,
  description,
  endpointTypes,
  name,
  config: { minimumCompressionSize, binaryMediaTypes },
  state: { stateMediaTypes }
}) => {
  const ops = []
  const op = {
    op: 'replace',
    path: '',
    value: ''
  }

  ops.push(Object.assign({}, op, { path: '/description', value: description }))
  ops.push(Object.assign({}, op, { path: '/endpointConfiguration/types/{type}', value: endpointTypes[0] }))
  ops.push(Object.assign({}, op, { path: '/name', value: name }))
  ops.push(Object.assign({}, op, { path: '/minimumCompressionSize', value: JSON.stringify(minimumCompressionSize) || null }))

  for (type of stateMediaTypes || []) {
    ops.push({ op: "remove", path: `/binaryMediaTypes/${type.replace(/\//gi, '~1')}`, value: type.replace(/\//gi, '~1') })
  }

  for (type of binaryMediaTypes || []) {
    ops.push({ op: 'replace', path: `/binaryMediaTypes/${type.replace(/\//gi, '~1')}`, value: type.replace(/\//gi, '~1') })
  }

  const api = await apig
    .updateRestApi({
      restApiId: apiId,
      patchOperations: ops
    }).promise()

  return api.id
}

const getPathId = async ({ apig, apiId, endpoint }) => {
  // todo this called many times to stay up to date. Is it worth the latency?
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

const enableCORS = ({ endpoints }) => {
  const defaultResponse = [{
    code: 200,
    headers: {
      "Access-Control-Allow-Headers": "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
      "Access-Control-Allow-Methods": "'GET,OPTIONS,POST,PUT,PATCH,DELETE'",
      "Access-Control-Allow-Origin": "'*'"
    }
  }]

  const paths = new Set()
  for (endpoint of endpoints) {
    // if the path has not already been configured
    if (!paths.has(endpoint.path)) {
      paths.add(endpoint.path)

      // append options resource
      const optionParams = {
        method: "OPTIONS",
        type: "MOCK",
        responses: defaultResponse,
        path: endpoint.path
      }
      endpoints.push(optionParams)
    }

    if (endpoint.responses && endpoint.responses.length) {
      const newResponses = []
      for (response of endpoint.responses) {
        newResponses.push(Object.assign({ headers: defaultResponse[0].headers }, response))
      }
      endpoint.responses = newResponses
    } else {
      endpoint.responses = defaultResponse
    }
  }

  return endpoints
}

const mergeModelObjects = ({ models, configModels, stateModels }) => {
  return configModels.map(model => {
    const modifiedModel = models.find(m => {
      return m.title === model.title
    })

    // if no modified model is found pull from state
    const stateModel = modifiedModel || stateModels.find(m => {
        return m.title === model.title
      })

    return modifiedModel || stateModel
  })
}

const endpointExists = async ({ apig, apiId, endpoint }) => {
  const resourceId = await retry(() => getPathId({ apig, apiId, endpoint }))

  if (!resourceId) {
    return false
  }

  const params = {
    httpMethod: endpoint.method,
    resourceId,
    restApiId: apiId
  }

  try {
    await retry(() => apig.getMethod(params).promise())
    return true
  } catch (e) {
    if (e.code === 'NotFoundException') {
      return false
    }
  }
}

const myEndpoint = (state, endpoint) => {
  if (
    state.endpoints &&
    state.endpoints.find((e) => e.method === endpoint.method && e.path === endpoint.path)
  ) {
    return true
  }
  return false
}

const mergeEndpointObjects = ({ endpoints, configEndpoints, stateEndpoints }) => {
  return configEndpoints.map(endpoint => {
    const modifiedEndpoint = endpoints.find(e => {
      return e.path === endpoint.path && e.method === endpoint.method
    })

    const stateEndpoint = modifiedEndpoint || stateEndpoints.find(e => {
      return e.path === endpoint.path && e.method === endpoint.method
    })

    return modifiedEndpoint || stateEndpoint
  })
}

const compareProps = ({ obj, previousObj }) => {
  // Both arrays and objects must have the same number of keys and each key be equal
  if (Array.isArray(obj) && previousObj) {
    return obj.length === previousObj.length
      && obj.every((key, i) => compareProps({ obj: key, previousObj: previousObj[i] }))
  }

  if (typeof obj === 'object' && previousObj) {
    const objKeys = Object.keys(obj)
    const previousObjKeys = Object.keys(previousObj)

    return objKeys.length === previousObjKeys.length
      && objKeys.every((key) => compareProps({ obj: obj[key], previousObj: previousObj[key] }))
  }

  return obj === previousObj
}

const isModified = async ({ obj, previousObj, lambda }) => {
  // Set authorizer and function values to arns if they are not
  if (obj.function && obj.function.slice(0, 4) !== "arn:") {
    const fxn = await lambda.getFunction({ FunctionName: obj.function }).promise()
    obj.function = fxn.Configuration.FunctionArn
  }

  if (obj.authorizer && obj.authorizer.slice(0, 4) !== "arn:") {
    const fxn = await lambda.getFunction({ FunctionName: obj.authorizer }).promise()
    obj.authorizer = fxn.Configuration.FunctionArn
  }

  // Remove fields in endpoint state that won't be in the config, allowing for comparison
  let previousCopy
  if (previousObj && previousObj.path && previousObj.method) {
    previousCopy = Object.assign({}, previousObj)
    delete previousCopy.authorizerId
    delete previousCopy.url
    delete previousCopy.id
  }

  return !compareProps({obj, previousCopy})
}

const validateEndpointObject = ({ endpoint, apiId, stage, region }) => {
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
    url: `https://${apiId}.execute-api.${region}.amazonaws.com/${stage}${endpoint.path}`,
    path: endpoint.path,
    method: endpoint.method.toUpperCase()
  }

  return { ...endpoint, ...validatedEndpoint }
}

const validateEndpoint = async ({ apig, apiId, endpoint, state, stage, region }) => {
  const validatedEndpoint = validateEndpointObject({ endpoint, apiId, stage, region })

  if (await endpointExists({ apig, apiId, endpoint: validatedEndpoint })) {
    if (!myEndpoint(state, validatedEndpoint)) {
      throw Error(
        `endpoint ${validatedEndpoint.method} ${validatedEndpoint.path} already exists in provider`
      )
    }
  }

  return validatedEndpoint
}

const validateEndpoints = async ({ apig, apiId, endpoints, lambda, state, stage, region }) => {
  const modifiedEndpoints = []
  for (i = 0; i < endpoints.length; i++) {
    const modified = await isModified({
      obj: endpoints[i],
      previousObj: state.endpoints ? state.endpoints[i] : null,
      lambda
    })

    if (modified) {
      modifiedEndpoints.push(endpoints[i])
    }
  }

  const promises = []
  for (endpoint of modifiedEndpoints) {
    promises.push(validateEndpoint({ apig, apiId, endpoint, state, stage, region }))
  }

  return Promise.all(promises)
}

const validateModel = ({ model, models, apiId }) => {
  if (!model.title) {
    throw Error('models must have a title')
  }

  const resolveReferences = (m) => Object.keys(m).forEach((key) => {
    if (typeof m[key] === 'object') {
      return resolveReferences(m[key])
    }

    if (key === '$ref') {
      const ref = models.find(ele => ele.title === m[key])
      if (ref) {
        m[key] = `https://apigateway.amazonaws.com/restapis/${apiId}/models/${m[key]}`
      } else {
        throw Error('referenced models must be present in the models object')
      }
    }
  })

  resolveReferences(model)

  return model
}

const validateModels = async ({ apiId, models, state }) => {
  const promises = models.reduce((m, model, i) => {
    const previousObj = state.models ? state.models[i] || {} : {}

    if (isModified({ obj: model, previousObj })) {
      m.push(validateModel({model, models, apiId}))
    }

    return m
  }, [])


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

  let createdPath
  try {
    createdPath = await apig.createResource(params).promise()
  } catch (error) {
    if (error.code === 'TooManyRequestsException') {
      await utils.sleep(1000)
      createdPath = await apig.createResource(params).promise()
    } else {
      throw error
    }
  }

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
    apiKeyRequired: endpoint.apiKey || true,
    restApiId: apiId
  }

  if (endpoint.authorizerId) {
    params.authorizationType = 'CUSTOM'
    params.authorizerId = endpoint.authorizerId
  }

  if (endpoint.model) {
    params.requestModels = {
      'application/json': endpoint.model
    }
  }

  /* create array of strings that exist inside {} in the uri path
    starts match on } so it will match even if no opening brace */
  const paths = endpoint.path.match(/[^{\}]+(?=})/g)
  if (paths && paths.length) {
    params.requestParameters = {}
    paths.forEach(path => {
      const key = `method.request.path.${path}`
      params.requestParameters[key] = true
    });
  }

  // Add headers and querystrings to method
  if (endpoint.params) {
    if (!params.requestParameters) params.requestParameters = {}
    const {headers, querystrings} = endpoint.params

    /* All headers and querystrings passed as static values
      rather than booleans will not be defined in the method */
    for (let h in headers) {
      if (typeof headers[h] === 'boolean') {
        const key = `method.request.header.${h}`
        params.requestParameters[key] = headers[h]
      }
    }

    for (let qs in querystrings) {
      if (typeof querystrings[qs] === 'boolean') {
        const key = `method.request.querystring.${qs}`
        params.requestParameters[key] = querystrings[qs]
      }
    }
  }

  try {
    await apig.putMethod(params).promise()
  } catch (e) {
    if (e.code === 'ConflictException' && endpoint.authorizerId) {
      // make sure authorizer config are always up to date
      const updateMethodParams = {
        httpMethod: endpoint.method,
        resourceId: endpoint.id,
        restApiId: apiId,
        patchOperations: [
          {
            op: 'replace',
            path: '/authorizationType',
            value: 'CUSTOM'
          },
          {
            op: 'replace',
            path: '/authorizerId',
            value: endpoint.authorizerId
          }
        ]
      }

      await apig.updateMethod(updateMethodParams).promise()
    } else if (e.code !== 'ConflictException') {
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

const createMethodResponse = ({ apig, apiId, endpoint }) => {
  const promises = []

  for (const response of (endpoint.responses || [])) {
    const params = {
      httpMethod: endpoint.method,
      resourceId: endpoint.id,
      restApiId: apiId,
      statusCode: `${response.code}`,
      responseModels: {
        'application/json': response.model || 'Empty'
      },
      responseParameters: response.headers ? Object.keys(response.headers).reduce((res, ele) => {
        res[`method.response.header.${ele}`] = false
        return res
      }, {})
      : {}
    }

    const p = apig.putMethodResponse(params).promise()
      .catch(e => {
        if (e.code === 'ConflictException') {
          const params = {
            httpMethod: endpoint.method,
            resourceId: endpoint.id,
            restApiId: apiId,
            statusCode: `${response.code}`,
            patchOperations:[{
              op: 'replace',
              path: '/responseParameters'
            }]
          }
          return apig.updateMethodResponse(params)
        }
        throw e
      })

    promises.push(p)
  }

  return promises
}

const createMethodResponses = async ({ apig, apiId, endpoints }) => {
  const promises = []

  for (const endpoint of endpoints) {
    promises.push(...createMethodResponse({apig, apiId, endpoint}))
  }

  return Promise.all(promises).then(() => endpoints)
}

const createModel = async ({ apig, apiId, model }) => {
  const params = {
    'contentType': 'application/json',
    name: model.title,
    restApiId: apiId,
    description: model.description || null,
    schema: JSON.stringify(model, null, '\t')
  }

  try {
    await apig.createModel(params).promise()
  } catch(e) {
    if (e.code === 'ConflictException') {
      await apig.updateModel({
        name: model.title,
        restApiId: apiId,
        patchOperations: [
          { op: 'replace', path: '/description', value: params.description },
          { op: 'replace', path: '/schema', value: params.schema }
        ]
      })
    } else {
      throw Error(e)
    }
  }
}

const createModels = async ({ apig, apiId, models }) => {
  for (const model of models) {
    // models must be created one at a time in case they reference eachother
    await createModel({ apig, apiId, model })
  }

  return models
}

const createIntegration = async ({ apig, lambda, apiId, endpoint }) => {
  const isLambda = !!endpoint.function
  let functionName, accountId, region

  if (isLambda) {
    if (endpoint.function.slice(0, 4) !== "arn:") {
      const func = await lambda.getFunction({ FunctionName: endpoint.authorizer }).promise()
      endpoint.function = func.Configuration.FunctionArn
    }
    functionName = endpoint.function.split(':')[6]
    accountId = endpoint.function.split(':')[4]
    region = endpoint.function.split(':')[3]
  }

  const integrationParams = {
    httpMethod: endpoint.method || 'POST',
    resourceId: endpoint.id,
    restApiId: apiId,
    type: endpoint.type || (isLambda ? 'AWS_PROXY' : 'HTTP')
  }

  if (endpoint.type !== 'MOCK') {
    integrationParams.uri = isLambda
      ? `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${endpoint.function}/invocations`
      : endpoint.URI

    integrationParams.integrationHttpMethod = endpoint.method
  }

  // create array of strings that exist inside {} in the uri path
  // starts match on } so it will match even if no opening brace
  const paths = endpoint.path.match(/[^{\}]+(?=})/g)
  if (paths && paths.length) {
    integrationParams.requestParameters = {}
    paths.forEach(path => {
      const key = `integration.request.path.${path}`
      const value = `method.request.path.${path}`
      integrationParams.requestParameters[key] = value
    });
  }

  // Add headers and querystrings to integration
  if (endpoint.params) {
    if (!integrationParams.requestParameters) integrationParams.requestParameters = {}
    const { headers, querystrings } = endpoint.params
    for (let h in headers) {
      const key = `integration.request.header.${h}`
      const value = typeof headers[h] === 'boolean' ? `method.request.header.${h}` : `'${headers[h]}'`
      integrationParams.requestParameters[key] = value
    }

    for (let qs in querystrings) {
      const key = `integration.request.querystring.${qs}`
      const value = typeof querystrings[qs] === 'boolean' ? `method.request.querystring.${qs}` : `'${querystrings[qs]}'`
      integrationParams.requestParameters[key] = value
    }
  }

  if (endpoint.template) {
    integrationParams.requestTemplates = { 'application/json': endpoint.template }
  }

  try {
    await apig.putIntegration(integrationParams).promise()
  } catch (e) {
    if (e.code === 'ConflictException') {
      // this usually happens when there are too many endpoints for
      // the same function. Retrying after couple of seconds ensures
      // any pending integration requests are resolved.
      await utils.sleep(2000)
      return createIntegration({ apig, lambda, apiId, endpoint })
    }
    throw Error(e)
  }

  // Create lambda trigger for AWS_PROXY endpoints
  if (isLambda) {
    const permissionsParams = {
      Action: 'lambda:InvokeFunction',
      FunctionName: functionName,
      Principal: 'apigateway.amazonaws.com',
      SourceArn: `arn:aws:execute-api:${region}:${accountId}:${apiId}/*/*`,
      StatementId: `${functionName}-${apiId}`
    }

    try {
      await lambda.addPermission(permissionsParams).promise()
    } catch (e) {
      if (e.code !== 'ResourceConflictException') {
        throw Error(e)
      }
    }
  }

  return endpoint
}

const createIntegrations = async ({ apig, lambda, apiId, endpoints }) => {
  const promises = []

  for (const endpoint of endpoints) {
    promises.push(createIntegration({ apig, lambda, apiId, endpoint }))
  }

  return Promise.all(promises)
}

const createIntegrationResponse = ({ apig, apiId, endpoint }) => {
  const promises = []
  if (!endpoint.responses) return []

  for (const response of endpoint.responses) {
    const params = {
      httpMethod: endpoint.method,
      resourceId: endpoint.id,
      restApiId: apiId,
      statusCode: `${response.code}`,
      selectionPattern: `${response.code}`,
      responseParameters: response.headers
      ? Object.keys(response.headers).reduce((res, ele) => {
        res[`method.response.header.${ele}`] = response.headers[ele]
        return res
      }, {})

      : {}
    }

    if (response.template) {
      params.responseTemplates = { 'application/json': response.template }
    }

    promises.push(apig.putIntegrationResponse(params).promise())
  }

  return promises
}

const createIntegrationResponses = async ({ apig, apiId, endpoints }) => {
  const promises = []

  for (const endpoint of endpoints) {
    promises.push(...createIntegrationResponse({ apig, apiId, endpoint }))
  }

  return Promise.all(promises).then(() => endpoints)
}

const createDeployment = async ({ apig, apiId, stage, deploymentDescription }) => {
  const deployment = await apig.createDeployment({ restApiId: apiId, stageName: stage, description: deploymentDescription }).promise()

  // todo add update stage functionality

  return deployment.id
}

const removeMethod = async ({ apig, apiId, endpoint }) => {
  const params = {
    restApiId: apiId,
    resourceId: endpoint.id,
    httpMethod: endpoint.method
  }

  try {
    await apig.deleteMethod(params).promise()
  } catch (e) {
    if (e.code !== 'NotFoundException') {
      throw Error(e)
    }
  }

  return {}
}

const removeMethods = async ({ apig, apiId, endpoints }) => {
  const promises = []

  for (const endpoint of endpoints) {
    promises.push(removeMethod({ apig, apiId, endpoint }))
  }

  return Promise.all(promises)
}

const removeResource = async ({ apig, apiId, endpoint }) => {
  try {
    await apig.deleteResource({ restApiId: apiId, resourceId: endpoint.id }).promise()
  } catch (e) {
    if (e.code !== 'NotFoundException') {
      throw Error(e)
    }
  }
  return {}
}

const removeResources = async ({ apig, apiId, endpoints }) => {
  const params = {
    restApiId: apiId
  }

  const resources = await apig.getResources(params).promise()

  const promises = []

  for (const endpoint of endpoints) {
    const resource = resources.items.find((resourceItem) => resourceItem.id === endpoint.id)

    const childResources = resources.items.filter(
      (resourceItem) => resourceItem.parentId === endpoint.id
    )

    const resourceMethods = resource ? Object.keys(resource.resourceMethods || {}) : []

    // only remove resources if they don't have methods nor child resources
    // to make sure we don't disrupt other services using the same api
    if (resource && resourceMethods.length === 0 && childResources.length === 0) {
      promises.push(removeResource({ apig, apiId, endpoint }))
    }
  }

  if (promises.length === 0) {
    return []
  }

  await Promise.all(promises)

  return removeResources({ apig, apiId, endpoints })
}

const removeApi = async ({ apig, apiId }) => {
  try {
    await apig.deleteRestApi({ restApiId: apiId }).promise()
  } catch (e) {}
}

const createAuthorizer = async ({ apig, lambda, apiId, endpoint }) => {
  if (endpoint.authorizer) {
    if (endpoint.authorizer.slice(0,4) !== "arn:") {
      const func = await lambda.getFunction({FunctionName: endpoint.authorizer}).promise()
      endpoint.authorizer = func.Configuration.FunctionArn
    }
    const authorizerName = endpoint.authorizer.split(':')[6]
    const region = endpoint.authorizer.split(':')[3]
    const accountId = endpoint.authorizer.split(':')[4]

    const authorizers = await apig.getAuthorizers({ restApiId: apiId }).promise()

    let authorizer = authorizers.items.find(
      (authorizerItem) => authorizerItem.name === authorizerName
    )

    if (!authorizer) {
      const createAuthorizerParams = {
        name: authorizerName,
        restApiId: apiId,
        type: 'TOKEN',
        authorizerUri: `arn:aws:apigateway:${region}:lambda:path/2015-03-31/functions/${endpoint.authorizer}/invocations`,
        identitySource: 'method.request.header.Auth'
      }

      authorizer = await apig.createAuthorizer(createAuthorizerParams).promise()

      const permissionsParams = {
        Action: 'lambda:InvokeFunction',
        FunctionName: authorizerName,
        Principal: 'apigateway.amazonaws.com',
        SourceArn: `arn:aws:execute-api:${region}:${accountId}:${apiId}/*/*`,
        StatementId: `${authorizerName}-${apiId}`
      }

      try {
        await lambda.addPermission(permissionsParams).promise()
      } catch (e) {
        if (e.code !== 'ResourceConflictException') {
          throw Error(e)
        }
      }
    }

    endpoint.authorizerId = authorizer.id
  }
  return endpoint
}

const createAuthorizers = async ({ apig, lambda, apiId, endpoints }) => {
  const updatedEndpoints = []

  for (const endpoint of endpoints) {
    endpoint.authorizerId = (await createAuthorizer({ apig, lambda, apiId, endpoint })).authorizerId
    updatedEndpoints.push(endpoint)
  }

  return updatedEndpoints
}

const removeAuthorizer = async ({ apig, apiId, endpoint }) => {
  // todo only remove authorizers that are not used by other services
  if (endpoint.authorizerId) {
    const updateMethodParams = {
      httpMethod: endpoint.method,
      resourceId: endpoint.id,
      restApiId: apiId,
      patchOperations: [
        {
          op: 'replace',
          path: '/authorizationType',
          value: 'NONE'
        }
      ]
    }

    await apig.updateMethod(updateMethodParams).promise()

    const deleteAuthorizerParams = { restApiId: apiId, authorizerId: endpoint.authorizerId }

    await apig.deleteAuthorizer(deleteAuthorizerParams).promise()
  }
  return endpoint
}

const removeAuthorizers = async ({ apig, apiId, endpoints }) => {
  const promises = []

  for (const endpoint of endpoints) {
    promises.push(removeAuthorizer({ apig, apiId, endpoint }))
  }

  await Promise.all(promises)

  return endpoints
}

const removeOutdatedEndpoints = async ({ apig, apiId, endpoints, stateEndpoints }) => {
  const outdatedEndpoints = []
  const outdatedAuthorizers = []
  for (const stateEndpoint of stateEndpoints) {
    const endpointInUse = endpoints.find(
      (endpoint) => endpoint.method === stateEndpoint.method && endpoint.path === stateEndpoint.path
    )

    const authorizerInUse = endpoints.find(
      (endpoint) => endpoint.authorizerId === stateEndpoint.authorizerId
    )

    if (!endpointInUse) {
      outdatedEndpoints.push(stateEndpoint)
    } else if (!authorizerInUse) {
      outdatedAuthorizers.push(stateEndpoint)
    }
  }

  await removeMethods({ apig, apiId, endpoints: outdatedEndpoints })
  await removeAuthorizers({ apig, apiId, endpoints: outdatedAuthorizers })
  await removeResources({ apig, apiId, endpoints: outdatedEndpoints })

  return outdatedEndpoints
}

const removeModel = async ({ apig, apiId, model }) => {
  const params = {
    modelName: model.title,
    restApiId: apiId
  }

  await apig.deleteModel(params).promise()

  return model
}

const removeModels = async ({ apig, apiId, models }) => {
  const promises = []

  for (const model of models) {
    promises.push(removeModel({ apig, apiId, model }))
  }

  await Promise.all(promises)

  return models
}

const removeOutdatedModels = async ({ apig, apiId, models, stateModels }) => {
  const outdatedModels = []

  for (const stateModel of stateModels) {
    const modelsInUse = models.find(
      (model) => model.title === stateModel.title
    )

    if (!modelsInUse) {
      outdatedModels.push(stateModel)
    }
  }

  await removeModels({ apig, apiId, models: outdatedModels })

  return outdatedModels
}

module.exports = {
  validateEndpointObject,
  validateEndpoint,
  validateEndpoints,
  validateModel,
  validateModels,
  endpointExists,
  myEndpoint,
  apiExists,
  createApi,
  getPathId,
  createAuthorizer,
  createAuthorizers,
  createDeployment,
  createIntegration,
  createIntegrations,
  createIntegrationResponse,
  createIntegrationResponses,
  createMethod,
  createMethods,
  createMethodResponse,
  createMethodResponses,
  createModel,
  createModels,
  createPath,
  createPaths,
  enableCORS,
  flattenArrays,
  mergeEndpointObjects,
  mergeModelObjects,
  removeMethod,
  removeMethods,
  removeModel,
  removeModels,
  removeResource,
  removeResources,
  removeAuthorizer,
  removeAuthorizers,
  removeApi,
  removeOutdatedEndpoints,
  removeOutdatedModels,
  retry,
  updateApi
}
