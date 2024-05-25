import path from 'path';
import { isExpressApp, isKoaApp, requireOrFail, versionCompare } from './helpers';

function getRedirectPrefix ({ req, ctx }) {
  const headers = (req && req.headers) || (ctx && ctx.headers) || {};
  return headers['x-forwarded-prefix'] ? headers['x-forwarded-prefix'] : '';
}

function generateSwaggerUIInitializerScript ({ docsJsonPath, ctx, req }) {
  const basePath = getRedirectPrefix({ req, ctx });

  return `
    window.onload = function() {
      window.ui = SwaggerUIBundle({
        url: "${basePath}${docsJsonPath}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [
          SwaggerUIBundle.presets.apis,
          SwaggerUIStandalonePreset
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl
        ],
        layout: "StandaloneLayout"
      });
    };
  `;
}

export const swaggerUI = async function (options) {
  let swaggerUI, swaggerUIVersion;
  try {
    swaggerUI = await import('swagger-ui-dist').then((mod) => mod.default);
    swaggerUIVersion = await import('swagger-ui-dist/package.json').then((mod) => mod.version);
  } catch (e) {
  }
  if (!swaggerUI || !swaggerUIVersion || versionCompare(swaggerUIVersion, '4.9.0') === -1) {
    throw new Error('swagger-ui-dist has to be installed in a version >= 4.9.0 when using feathers-swagger.swaggerUI function');
  }

  const { docsPath = '/docs', indexFile, getSwaggerInitializerScript } = options || {};
  if (docsPath[docsPath.length - 1] === '/') {
    throw new Error('swaggerUI.docsPath must not contain a trailing slash');
  }

  let absoluteIndexFile = indexFile;
  if (indexFile && !path.isAbsolute(indexFile)) {
    absoluteIndexFile = path.join(process.cwd(), indexFile);
  }

  const swaggerInitializerPath = `${docsPath}/swagger-initializer.js`;

  return async function initSwaggerUI (app, swaggerConfig) {
    const { docsJsonPath, specs } = swaggerConfig;

    if (isExpressApp(app)) {
      const express = await import('express');

      if (indexFile) {
        app.get(docsPath, function (req, res) {
          res.sendFile(absoluteIndexFile);
        });
      }

      app.get(swaggerInitializerPath, function (req, res) {
        res.type('application/javascript');
        res.send((getSwaggerInitializerScript || generateSwaggerUIInitializerScript)(
          { docsPath, docsJsonPath, specs, req, app })
        );
      });

      app.get(docsPath, function (req, res, next) {
        if (req.url === docsPath) {
          res.redirect(getRedirectPrefix({ req }) + docsPath + '/');
        } else {
          next();
        }
      });

      app.use(docsPath, express.static(swaggerUI.getAbsoluteFSPath()));
    } else if (isKoaApp(app)) {
      const serveStatic = await requireOrFail('koa-static', 'to use Swagger UI with koa');
      const koaMount = await requireOrFail('koa-mount', 'to use Swagger UI with koa');

      if (indexFile) {
        const koaSend = await requireOrFail('koa-send', 'to use Swagger UI with koa');
        const paths = [docsPath, `${docsPath}/`, `${docsPath}/index.html`];
        let relativeFilePath = indexFile;
        const sendOptions = {};
        relativeFilePath = path.basename(absoluteIndexFile);
        sendOptions.root = path.dirname(absoluteIndexFile);

        app.use(async (ctx, next) => {
          if (paths.includes(ctx.url)) {
            await koaSend(ctx, relativeFilePath, sendOptions);
          } else {
            await next();
          }
        });
      }

      app.use(async (ctx, next) => {
        if (ctx.url === swaggerInitializerPath) {
          ctx.type = 'application/javascript';
          ctx.body = (getSwaggerInitializerScript || generateSwaggerUIInitializerScript)(
            { docsPath, docsJsonPath, specs, ctx, app }
          );
        } else {
          return next();
        }
      });

      app.use(async (ctx, next) => {
        if (ctx.url === docsPath) {
          ctx.redirect(getRedirectPrefix({ ctx }) + docsPath + '/');
        } else {
          return next();
        }
      });

      app.use(koaMount(docsPath, serveStatic(swaggerUI.getAbsoluteFSPath())));
    }
  };
};
