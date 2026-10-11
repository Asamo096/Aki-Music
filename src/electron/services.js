import clc from 'cli-color';
// 副作用导入：该模块只负责在临时目录创建 anonymous_token 文件，没有任何导出。
// 上游写成默认导入（import checkAuthToken from ...），靠 webpack 宽松的 ES 互操作才成立，
// esbuild 的严格语义下会报 "No matching export"。这里改为纯副作用导入。
import '../utils/checkAuthToken';
import server from '@neteaseapireborn/api/server';

export async function startNeteaseMusicApi() {
  // Let user know that the service is starting
  console.log(`${clc.redBright('[NetEase API]')} initiating NCM API`);

  // Load the NCM API.
  await server.serveNcmApi({
    port: 10754,
    moduleDefs: require('../ncmModDef'),
  });
}
