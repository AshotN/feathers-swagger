import OpenApiV2Generator from './v2/generator.js';
import OpenApiV3Generator from './v3/generator.js';

import { isExpressApp, isKoaApp } from './helpers.js';

const init = function (config) {
  return async function () {
    const app = this;

    const { ui, docsJsonPath = '/swagger.json', appProperty = 'docs', openApiVersion = 3 } = config;

    const specs = {};
    if (appProperty) {
      app[appProperty] = specs;
    }

    if (isExpressApp(app)) {
      app.get(docsJsonPath, (req, res) => {
        res.json(specs);
      });
    } else if (isKoaApp(app)) {
      app.use(async (ctx, next) => {
        if (ctx.url === docsJsonPath) {
          ctx.body = specs;
        }
        return next();
      });
    }

    let specGenerator;
    if (openApiVersion === 2) {
      specGenerator = new OpenApiV2Generator(app, specs, config);
    } else if (openApiVersion === 3) {
      specGenerator = new OpenApiV3Generator(app, specs, config);
    } else {
      throw new Error(`Unsupported openApiVersion ${openApiVersion}! Allowed: 2, 3`);
    }

    // Register this plugin
    /* istanbul ignore else for feathers versions < 3 */
    if ((app.version && parseInt(app.version, 10) >= 3) || Array.isArray(app.mixins)) {
      app.mixins.push(specGenerator.addService);
    } else {
      app.providers.push((path, service) => specGenerator.addService(service, path));
    }

    // init UI module
    if (ui) {
      const uiFn = await ui;
      uiFn(app, { docsJsonPath, specs, openApiVersion });
    }
  };
};

export default init;
export * from './custom-methods.js';
export * from './utils.js';
export * from './swagger-ui-dist.js';
