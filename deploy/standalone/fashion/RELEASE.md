# 时尚工作台 1.0.0 · .studio 迁移

本版整合当前蓝灰手机版、紧凑桌面布局、圆形展开菜单、来源范围选择、真实图片检索/核查/交付，以及一千个候选来源的桌面管理。

- 客户入口：https://happyspa.studio/fashion/ ，免登录，以独立随机 HttpOnly Secure Cookie 隔离访客。
- 管理入口：https://happyspa.studio/fashion-admin/settings/sources ，沿用 myOS 平台管理员身份，客户无法访问来源目录和配置。
- 旧流程配置及浏览器资料：https://happyspa.studio/fashion-admin/legacy/rich.html 。旧资料通过原浏览器的 .dev 导出页面与管理员导入页面迁移，不能跨域直接读取。
- 数据目录：现有持久数据库所在目录的 fashion-workbench 子目录；不读写 myOS 的 SQLite 业务表。访客会话、任务、原图缓存及来源覆盖配置均随重启保留。
- 首次来源清单为一千个候选来源，不能等同一千个已接入采集器；品牌/媒体/零售范围沿用现有检索计划。
- 图片导出保留 SHA-256、原始页与原图映射；核查与选入分开，交付时重新验证。
- .dev 的旧入口仅在新站上线验证后切换；原浏览器数据不删除。
- myOS 根路径、账号、数据库、管理员权限与现有服务路径继续保留。

部署沿用 Life OS 现有 Node/SSH 流水线及原子版本切换、健康检查与失败回滚，不使用临时公网隧道或另建 Sites 站点。
