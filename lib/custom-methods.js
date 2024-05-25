import _ from 'lodash';
import { checkImport, isExpressApp, isKoaApp, requireOrFail } from './helpers';

const CUSTOM_METHOD = Symbol('feathers-swagger/CUSTOM_METHOD');

const createCustomMethodsFetcher = async () => {
  if (await checkImport('@feathersjs/express/rest', 'HTTP_METHOD')) {
    const { activateHooks } = await import('@feathersjs/feathers').then((mod) => mod.default);
    const { HTTP_METHOD, httpMethod } = await import('@feathersjs/express/rest').then((mod) => mod.default);

    const getCustomMethods = (app, service, defaultMethods, basePath, doc) => {
      const customMethods = [];
      if (!service.methods) {
        return customMethods;
      }
      Object.keys(_.omit(service.methods, Object.keys(defaultMethods))).forEach((method) => {
        const serviceMethod = service[method];
        if (typeof serviceMethod !== 'function' || doc.operations[method] === false) {
          return;
        }
        const httpMethod = serviceMethod[HTTP_METHOD];
        if (!httpMethod) {
          return;
        }
        httpMethod.forEach(({ verb, uri }) => {
          const path = `${basePath}${uri}`;
          customMethods.push({ path, method, httpMethod: verb.toLowerCase() });
        });
      });
      return customMethods;
    };

    const registerCustomMethod = (verb, path) => {
      const hooksParams = ['data', 'params'];
      if (path.includes(':__feathersId')) {
        hooksParams.push('id');
      }
      return (method) => httpMethod(verb, path)(activateHooks(hooksParams)(method));
    };

    return { getCustomMethods, registerCustomMethod, customMethodsHandler: _.noop };
  }

  if (await checkImport('@feathersjs/feathers', 'getServiceOptions')) {
    const { getServiceOptions, defaultServiceMethods } = await import('@feathersjs/feathers').then((mod) => mod.default);
    const { http } = await import('@feathersjs/transport-commons').then((mod) => mod.default);

    const CUSTOM_METHOD_HANDLER = '_feathers_swagger_custom_method_handler_';

    const getCustomMethods = (app, service, defaultMethods, basePath, doc, serviceOptions) => {
      const serviceCustomMethods = [];
      const localServiceOptions = serviceOptions || getServiceOptions(service);
      if (!localServiceOptions || !localServiceOptions.methods) {
        return serviceCustomMethods;
      }

      localServiceOptions.methods.forEach((method) => {
        if (defaultServiceMethods.includes(method)) {
          return;
        }
        const serviceMethod = service[method];
        if (typeof serviceMethod !== 'function' || doc.operations[method] === false) {
          return;
        }
        const customMethods = serviceMethod[CUSTOM_METHOD];
        if (!customMethods || !app[CUSTOM_METHOD_HANDLER]) {
          return;
        }
        customMethods.forEach(({ verb, path: uri }) => {
          const httpMethod = verb.toLowerCase();
          const path = `${basePath}${uri}`;
          app[CUSTOM_METHOD_HANDLER](basePath, path, method, httpMethod);
          serviceCustomMethods.push({ path, method, httpMethod });
        });
      });
      return serviceCustomMethods;
    };

    const registerCustomMethod = (verb, path) => (method) => {
      if (!method[CUSTOM_METHOD]) {
        method[CUSTOM_METHOD] = [];
      }
      method[CUSTOM_METHOD].push({ verb, path });
      return method;
    };

    const customMethodsHandler = async (app) => {
      if (isExpressApp(app)) {
        const { Router } = await import('express').then((mod) => mod.default);
        const router = Router();
        app.use(router);
        app[CUSTOM_METHOD_HANDLER] = (basePath, path, method, httpMethod) => {
          router[httpMethod](path, (req, res, next) => {
            req.url = basePath;
            req.headers[http.METHOD_HEADER] = method;
            req.method = 'POST';
            req.feathers = { ...req.feathers, params: req.params };
            next();
          });
        };
      } else if (isKoaApp(app)) {
        const Router = await requireOrFail('@koa/router', 'to use the customMethodsHandler');
        const router = new Router();

        app.use(router.routes()).use(router.allowedMethods());
        app[CUSTOM_METHOD_HANDLER] = (basePath, path, method, httpMethod) => {
          router[httpMethod](path, async (ctx, next) => {
            ctx.request.path = basePath;
            ctx.request.headers[http.METHOD_HEADER] = method;
            ctx.request.method = 'POST';
            ctx.feathers = { ...ctx.feathers, params: ctx.params };
            await next();
          });
        };
      }
      return app;
    };

    return { getCustomMethods, registerCustomMethod, customMethodsHandler };
  }

  return {
    getCustomMethods: () => [],
    registerCustomMethod: _.identity,
    customMethodsHandler: _.noop
  };
};

const { getCustomMethods, registerCustomMethod, customMethodsHandler } = await createCustomMethodsFetcher();

function customMethodDecorator (verb, path) {
  return function (target, propertyKey) {
    target[propertyKey] = customMethod(verb, path)(target[propertyKey]);
  };
}

function customMethod (verb, path) {
  return function () {
    if (arguments.length === 1) {
      return registerCustomMethod(verb, path)(arguments[0]);
    }
    return customMethodDecorator(verb, path)(...arguments);
  };
}

export {
  registerCustomMethod,
  customMethodDecorator,
  getCustomMethods,
  customMethodsHandler,
  customMethod,
  CUSTOM_METHOD
};
