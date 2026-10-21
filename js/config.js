/**
 * 云端账号配置
 * 在 Supabase 项目后台的 Project Settings -> API 中复制以下两项填入即可启用云端账号。
 * 匿名密钥（anon public key）可以安全地放在前端代码里。
 * 留空时游戏自动进入本地试玩模式。
 */
window.GAME_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: ''
};
