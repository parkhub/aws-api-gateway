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

const createApi = async ({ apig, name, description, config: { minimumCompressionSize, binaryMediaTypes }}) => {
  const api = await apig
    .createRestApi({
      name,
      description,
      minimumCompressionSize,
      binaryMediaTypes
    })
    .promise()

  return api.id
}

/* Yaml does not allow merging arrays so it should be assumed they are nested,
   this way the user may use yaml anchors to reuse arrays */
const flattenArrays = (obj) => {
  for (var k in obj) {
    if (Array.isArray(obj[k])) {
      obj[k] = obj[k].flat(Infinity)
      flattenArrays(obj[k])
    } else if (typeof obj[k] == "object" && obj[k] !== null) {
      flattenArrays(obj[k]);
    }
  }
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

const updateApi = ({ template, name, description, binaryMediaTypes, minimumCompressionSize }) => {
  template.info.title = name
  template.info.description = description
  template.info.version = "2016-09-12T17:50:37Z"
  template["x-amazon-apigateway-minimum-compression-size"] = minimumCompressionSize
  template["x-amazon-apigateway-binary-media-types"] = binaryMediaTypes
  return template
}

const createModels = ({ template, models }) => {
  template.components = {schemas:{}}
  models = models.flat()
  for (let model of models) {
    template.components.schemas[model.title] = model
  }

  return template
}

const createAuthorizer = async ({ apig, lambda, apiId, endpoint}) => {
  if (endpoint.authorizer.slice(0, 4) !== "arn:") {
    const func = await lambda.getFunction({ FunctionName: endpoint.authorizer }).promise()
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
    } catch (error) {
      if (error.code != 'ResourceConflictException') {
        throw error
      }
    }

    return authorizer
  } else {
    return authorizer
  }
}

const createPaths = async ({ template, endpoints, apig, lambda, apiId, region }) => {
  const authorizers = []
  for (let endpoint of endpoints) {
    if (!endpoint.path || !endpoint.method) {
      throw Error('Endpoints must have method and path')
    }

    template.paths[endpoint.path] = template.paths[endpoint.path] || {}
    template.paths[endpoint.path][endpoint.method.toLowerCase()] = {}
    const path = template.paths[endpoint.path][endpoint.method.toLowerCase()]

    let authorizer = endpoint.authorizer
    if (endpoint.authorizer) {
      const created = authorizers.find(ele => ele.name === endpoint.authorizer)

      if (!created) {
        authorizer = await createAuthorizer({apig, lambda, apiId, endpoint})
        authorizers.push(authorizer)
      }
    }

    path["x-amazon-apigateway-integration"] = {}
    if (endpoint.params) {
      const {parameters, integrationParams} = setPathParams({params: endpoint.params, path: endpoint.path})
      path.parameters = parameters
      if (!endpoint.function) {
        path["x-amazon-apigateway-integration"].requestParameters = integrationParams
      }
    }

    if (endpoint.responses && !endpoint.function) {
      const {responses, integrationResponses} = setPathResponses({resps: endpoint.responses})
      path.responses = responses
      path["x-amazon-apigateway-integration"].responses = integrationResponses
    } else if (endpoint.function) {
      path["x-amazon-apigateway-integration"].responses = { default: { statusCode: "200" } }
      path.responses = {}
    }

    path.security = [{"api_key":[]}]
    if (endpoint.authorizer) {
      const obj = {}
      obj[authorizer.name] = []
      path.security.push(obj)
    }

    path["x-amazon-apigateway-integration"].passthroughBehavior = "when_no_match"

    if (endpoint.template)
      path.requestTemplates = {"application/json": path.template}

    if (endpoint.method === 'OPTIONS') {
      path["x-amazon-apigateway-integration"].type = 'mock'
    } else {
      path["x-amazon-apigateway-integration"].httpMethod = endpoint.method
      path["x-amazon-apigateway-integration"].type = endpoint.URI ? 'http' : 'aws_proxy'
    }

    if (endpoint.URI) {
      path["x-amazon-apigateway-integration"].uri = endpoint.URI
    } else if (endpoint.method.toLowerCase() != 'options') {
      const arn = await getLambda({func: endpoint.function, lambda})
      path["x-amazon-apigateway-integration"].httpMethod = 'post'
      path["x-amazon-apigateway-integration"].uri = `arn:aws:apigateway:${endpoint.region || region}:lambda:path/2015-03-31/functions/${arn}/invocations`
    }

    if (endpoint.validator) {
      setValidator({ validator: endpoint.validator, template, endpoint })
    }
  }

  return template
}

const createDocumentation = ({ template, endpoints, models }) => {
  for (let endpoint of endpoints) {
    if (endpoint.description) {

    }

    if (endpoint.params) {
      for (let query in endpoint.params.querystrings) {}
      for (let header in endpoint.params.headers) {}
      for (let path in endpoint.params.paths) {}
    }
  }

  for (let model of models) {}
}

const setValidator = async ({validator, template, endpoint}) => {
  template["x-amazon-apigateway-request-validators"] = {
    Body: { validateRequestBody: true, validateRequestParameters: false },
    Params: { validateRequestBody: false, validateRequestParameters: true },
    BodyAndParams: { validateRequestBody: true, validateRequestParameters: true },
  }

  const path = template.paths[endpoint.path][endpoint.method.toLowerCase()]
  switch (validator) {
    case 0:
      path["x-amazon-apigateway-request-validator"] = 'Body'
      break
    case 1:
      path["x-amazon-apigateway-request-validator"] = 'BodyAndParams'
      break
    case 2:
      path["x-amazon-apigateway-request-validator"] = 'Params'
      break
    default:
      path["x-amazon-apigateway-request-validator"] = 'NONE'
  }

  return template
}

const addLambdaPermissions = async ({ endpoints, apiId, lambda, region }) => {
  for (let endpoint of endpoints) {
    if (endpoint.function) {
      const arn = await getLambda({ func: endpoint.function, lambda })
      const accountId = arn.split(':')[4]
      const permissionsParams = {
        Action: 'lambda:InvokeFunction',
        FunctionName: endpoint.function,
        Principal: 'apigateway.amazonaws.com',
        SourceArn: `arn:aws:execute-api:${region}:${accountId}:${apiId}/*/${endpoint.method}${endpoint.path}`,
        StatementId: `${endpoint.function}-${apiId}-${endpoint.method}-${endpoint.path.split('/').join('')}`
      }

      try {
        await lambda.addPermission(permissionsParams).promise()
      } catch (e) {
        if (e.code !== 'ResourceConflictException') {
          throw Error(e)
        }
      }
    }
  }
}

const getLambda = async ({func, lambda}) => {
  let arn = func
  if (func.slice(0, 4) !== "arn:") {
    const f = await lambda.getFunction({ FunctionName: func }).promise()
    arn = f.Configuration.FunctionArn
  }

  return arn
}

const setPathParams = ({params, path}) => {
  parameters = []
  integrationParams = {}
  for (let query in params.querystrings) {
    if (typeof params.querystrings[query] === 'boolean') {
      parameters.push({ name: query, in: "query", schema: { type: "string" }, required: params.querystrings[query] })
      integrationParams[`integration.request.querystring.${query}`] = `method.request.querystring.${query}`
    } else if (typeof params.querystrings[query].value === 'boolean') {
      parameters.push({ name: query, in: "query", schema: { type: "string" }, required: params.querystrings[query].value })
      integrationParams[`integration.request.querystring.${query}`] = `method.request.querystring.${query}`
    } else {
      integrationParams[`integration.request.querystring.${query}`] = `'${params.querystrings[query] || params.querystrings[query].value}'`
    }
  }

  for (let header in params.headers) {
    if (typeof params.headers[header] === 'boolean') {
      parameters.push({ name: header, in: "header", schema: { type: "string" }, required: params.headers[header] })
      integrationParams[`integration.request.header.${header}`] = `method.request.header.${header}`
    } else if (typeof params.headers[header].value === 'boolean') {
      parameters.push({ name: header, in: "header", schema: { type: "string" }, required: params.headers[header].value })
      integrationParams[`integration.request.header.${header}`] = `method.request.header.${header}`
    } else {
      integrationParams[`integration.request.header.${header}`] = `'${params.headers[header] || params.headers[header].value}'`
    }
  }

  const paths = path.match(/[^{\}]+(?=})/g)
  if (paths && paths.length) {
    for (let p of paths) {
      parameters.push({ name: p, in: "path", schema: { type: "string" }, required: true })
      integrationParams[`integration.request.path.${p}`] = `method.request.path.${p}`
    }

    for (let p in params.paths) {
      integrationParams[`integration.request.path.${p}`] = params.paths[p] || params.paths[p].value
    }
  }

  return {parameters, integrationParams}
}

const setPathResponses = ({resps}) => {
  const responses = {}, integrationResponses = {}
  for (let response of resps) {
    responses[response.code] = { "description": `${response.code} response`}
    integrationResponses[response.code] = {}

    for (let header in response.headers) {
      responses[response.code].headers = responses[response.code].headers || {}
      responses[response.code].headers[header] = {schema:{type:"string"}}
      integrationResponses[response.code].statusCode = `${response.code}`
      integrationResponses[response.code].responseParameters = {}
      integrationResponses[response.code].responseParameters[`method.response.header.${header}`] = response.headers[header]
    }

    if (response.template) {
      integrationResponses[response.code].responseTemplates = { "application/json": response.template }
    }
  }

  return {responses, integrationResponses}
}

const createDeployment = async ({ apig, apiId, stage, deploymentDescription }) => {
  const deployment = await apig.createDeployment({ 
    restApiId: apiId, 
    stageName: stage, 
    description: deploymentDescription
  }).promise()

  return deployment.id
}

const removeApi = async ({ apig, apiId }) => {
  try {
    await apig.deleteRestApi({ restApiId: apiId }).promise()
  } catch (e) {}
}

module.exports = {
  apiExists,
  createApi,
  createDeployment,
  createDocumentation,
  enableCORS,
  flattenArrays,
  removeApi,
  updateApi,
  createModels,
  createPaths,
  addLambdaPermissions
}
