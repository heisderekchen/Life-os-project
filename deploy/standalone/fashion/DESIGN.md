---
name: 鞋履设计工作台
description: 用户选定的蓝灰鞋履工作室方向与圆形入口向右展开菜单
colors:
  ink: "#11141a"
  muted: "#5d6573"
  accent: "#154bea"
  accent-active: "#0733b3"
  pale: "#e9efff"
  line: "#dce2e9"
  paper: "#fff"
  ground: "#f0f3f6"
  bad: "#a33332"
  warm: "#765413"
typography:
  display:
    fontSize: "clamp(40px, 10.5vw, 58px)"
    fontWeight: 750
    lineHeight: 1.05
    letterSpacing: "-0.04em"
  headline:
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "-0.025em"
  title:
    fontSize: "21px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  item-title:
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1.5
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif'
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  action:
    fontSize: "14px"
    fontWeight: 650
  input:
    fontSize: "16px"
  menu-item:
    fontSize: "16px"
  label:
    fontSize: "12px"
rounded:
  status: "5px"
  choice: "8px"
  control: "9px"
  action-bar: "11px"
  list: "12px"
  card: "13px"
  menu-item: "16px"
  menu-panel: "24px"
  pill: "999px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  xxl: "32px"
  desktop: "40px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.paper}"
    typography: "{typography.action}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
  button-primary-active:
    backgroundColor: "{colors.accent-active}"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 17px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.input}"
    rounded: "{rounded.control}"
    padding: "12px"
  result-card:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.card}"
  menu-toggle:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
  menu-panel:
    backgroundColor: "{colors.paper}"
    rounded: "{rounded.menu-panel}"
    padding: "8px"
  menu-item-active:
    backgroundColor: "{colors.pale}"
    textColor: "{colors.accent}"
    rounded: "{rounded.menu-item}"
    padding: "10px 18px"
  status:
    rounded: "{rounded.status}"
    padding: "3px 7px"
---

# Design System: 鞋履设计工作台

## Overview

**Creative North Star: "蓝灰鞋履工作室"**

用户选定第二版视觉与圆形入口向右展开菜单。冷灰背景承托鞋履封面，cobalt 蓝集中在入口、链接与选中状态；紧凑标题和交错图文模块构成首页。此方向替代旧的青绿色身份描述。

默认首页是工作台，包含检索任务与交付结果两个功能模块。2 张独立 AI 生成的 WebP 只作装饰封面，不能充当检索结果、真实产品事实或核查证据。功能页面继续以清晰表单、列表与来源卡片完成工作。

**Key Characteristics:**

- 蓝灰资料面与 cobalt 蓝操作色。
- 首页图文交错，功能页保持紧凑可读。
- 圆形三横线入口向右展开三项菜单。
- 装饰图、来源预览与人工核查证据分开表达。

本文件依据实际 CSS 与 DOM；浏览器验证受策略拦截，尚无截图、真实手机、桌面视觉或打印验收。参考图选定不等于设计 QA 通过。

## Colors

### Primary

- **Cobalt 蓝（accent）**：模块入口、主要按钮、链接、菜单图标与当前项。
- **深 cobalt 蓝（accent-active）**：入口悬浮与主要按钮按下反馈。
- **浅蓝（pale）**：菜单当前项、悬浮项与选择反馈。

### Neutral

- **墨黑（ink）**：标题、正文与菜单。
- **蓝灰（muted）**：来源、日期与辅助说明。
- **浅灰线（line）**：列表、控件与卡片边界。
- **纸白（paper）**：菜单、卡片与表单。
- **冷灰底（ground）**：工作区与首页模块底面。

错误红、历史示例暖色与已核查状态色保留其业务语义，状态同时配文字。

**The Evidence Rule.** 首页装饰封面不进入检索与交付证据；来源预览图仍需人工核查。

## Typography

系统字体栈依次使用 Apple 系统字体、苹方、微软雅黑和通用无衬线。首页大标题使用 Display，桌面增至（40px）；模块标题按视口变化。功能页基准标题、结果标题与辅助字号见前置 tokens。

手机输入保持（16px），桌面宽视口核查/筛选控件使用（14px）。长标题、域名、链接与依据允许换行；统计数字使用等宽数字特性。

## Layout

首页头部使用紧凑文字区，不放装饰背景图。手机两个模块依次排列，高（200px），文字与图片采用（60%/40%）和（40%/60%）交错比例；768px 起两列，高（240px），1100px 起高（260px）。装饰封面使用 cover 裁切，结果鞋图使用 contain 保留轮廓；二者目的不同。

功能页手机主区最大宽度（760px）、横向留白（20px），结果单列；（768px 起）两列；（1100px 起）三列，主区最大宽度（1260px）。桌面首页两模块并排。所有视口保留同一浮动菜单，不设侧栏。

菜单入口为左下角（56px）圆形三横线按钮，手机距左至少（20px）、底部（16px + 安全区）；桌面距左至少（32px）、底部（24px + 安全区）。点击后在右侧（8px）展开横向三项功能菜单，宽度随窄屏收缩，选择后收起。桌面交付操作条距底部（104px + 安全区），避免与菜单重叠。

打印隐藏菜单、应用导航与操作区，结果顺序排版；实际打印仍待验证。

## Elevation & Depth

资料卡以细边框和白底分层。阴影用于浮动菜单与操作反馈，不给每个结果卡增加阴影。

- **操作区 / 消息**：`0 10px 32px #0000000d`。
- **圆形菜单按钮**：`0 10px 32px #0000001f`。
- **展开面板**：`0 12px 40px #00000024`。

## Shapes

首页模块为平直图文分区，功能控件使用温和圆角。菜单入口采用圆形，展开面板与菜单项采用圆角；具体值以前置 tokens 为准。结果照片保持（4:3）图框，缺图保留可读说明。

## Components

### Buttons / Inputs

主要按钮最小高（46px），文字动作与时间选择至少（44px）；模块入口手机最小高（44px）、中等视口（52px）。输入为白底、灰色描边与（12px）内边距。所有交互控件使用蓝色（3px）焦点轮廓、偏移（3px）。

### Workspace Menu

圆形按钮直径（56px），只显示三横线图标；右侧展开面板包含工作台、检索任务、交付结果，菜单项最小高（46px）。Phosphor 图标以本地静态 SVG 提供，界面使用 CSS mask，装饰图标不参与无障碍名称。

按钮切换展开；外部点击、焦点移出或 Escape 收起。支持方向键移动，Escape 返回触发器焦点，快速关闭后可重新打开。关闭项使用 hidden/inert 与 aria 状态控制。轮询在菜单展开期间延后应用数据，收起后继续轮询，避免焦点与菜单被重绘打断。

箭头与面板过渡（170ms ease-out），展开动画（180ms cubic-bezier(0.16, 1, 0.3, 1)），位移（8px）。减少动态效果时关闭动画和过渡，保留直接状态反馈。

### Lists / Result Cards

四项状态筛选等宽排列，任务列表置于白底描边容器。结果卡包含配图或缺图说明、原始来源、日期与核查区。核查与选入分离，交付呈只读快照；轮询不能覆盖未保存的核查编辑。

### Progress / Status

检索使用不定进度（1.6s ease-in-out），不伪造百分比。减少动态效果时静态铺满。所有任务、核查与示例状态同时给出文字。

## Do's and Don'ts

### Do:

- **Do** 以实际 cobalt tokens 与系统字体延展界面。
- **Do** 保留圆形入口、向右展开面板与选中项提示。
- **Do** 保留手机安全区、键盘焦点与减少动态效果支持。
- **Do** 明确区分装饰封面、来源预览与人工核查依据。

### Don't:

- **Don't** 将 AI 装饰封面加入真实检索或交付结果。
- **Don't** 用轮询打断展开菜单或未保存的核查编辑。
- **Don't** 用浮动菜单遮挡交付操作。
- **Don't** 将代码/DOM 检查写成视觉、真机、照片覆盖或打印验收通过。

## 来源范围控件（2026-10-19）
新建检索页使用原生三档范围滑杆：聚焦、均衡、广泛，支持触摸拖动、键盘与点击档位。标题右侧显示当前档位，描述、补充来源标签同步更新。品牌官方、专业媒体、零售平台可勾选；旁边数字代表初始目录站点数，不代表本次命中量。社交社区与图片素材库显示待接入，不可选择。网站明细与补充域名收在折叠区。拖动不播放额外装饰动画。

## 桌面设置：来源管理
本机管理视图采用216px侧栏与密集表格，沿用蓝灰与cobalt操作色，不使用装饰照片。五类导航、筛选和每页50条；编辑使用440px侧边对话框，160ms短位移，减少动态效果时取消动画。客户端隐藏完整目录、内部数量、来源地址配置与待接入提示，保留检索偏好。
