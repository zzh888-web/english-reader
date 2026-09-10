# English Reader — 与大模型共读英文书的本地阅读器

一个运行在本地的英文书阅读器：左侧是书页（界面全英文，营造沉浸式阅读环境），右侧是 AI 伴读对话栏。右键任意句子即可翻译（译文显示在原句下方）或解释（解释进入右侧对话栏），也支持划选任意文字后右键操作。任意 OpenAI 兼容接口的大模型都能接入。

## 启动

方式一（推荐）：双击桌面上的 **`English Reader.bat`**，会弹出服务窗口并自动打开浏览器。

方式二（命令行）：

```
cd C:\Users\DELL\ZCodeProject\english-reader
python server.py
```

浏览器会自动打开 `http://127.0.0.1:8765`（端口被占用时会明确提示，需先关闭旧实例）。关闭服务窗口或按 Ctrl+C 即停止。**首次使用请点右上角 ⚙ 打开设置，填入大模型 API（设置界面为中文）。**

## 接入大模型（Settings 设置）

| 服务商标签 | Base URL | 获取 Key |
|---|---|---|
| OpenAI | `https://api.openai.com/v1` | platform.openai.com |
| DeepSeek | `https://api.deepseek.com/v1` | platform.deepseek.com |
| Moonshot Kimi | `https://api.moonshot.cn/v1` | platform.moonshot.cn |
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | open.bigmodel.cn |
| OpenRouter | `https://openrouter.ai/api/v1` | openrouter.ai |
| Google Gemini（OpenAI 兼容端点） | `https://generativelanguage.googleapis.com/v1beta/openai` | aistudio.google.com |
| Ollama（本地，无需 Key） | `http://localhost:11434/v1` | 无需 |

- 预设下拉框选择后自动填好 Base URL 和默认模型；也可选 Custom… 填任意 OpenAI 兼容地址（任何转发/中转服务均可）。
- 模型名可手填，或点 **Fetch models** 自动拉取列表；**Test connection** 可一键测试连通性。
- API Key 只保存在本机浏览器 localStorage，仅通过本地代理发给你填写的 Base URL，不经过任何第三方。
- **Temperature（温度）**：控制模型输出的"随机/发散"程度，范围 0～1。**调低（0～0.3）**：回答更稳定、保守、贴事实，适合词汇辨析、语法答疑、背景考证；**调高（0.7～1.0）**：表达更多样、有想象力，适合文学赏析、开放式讨论。默认 0.7 是通用平衡值；不确定就保持默认。另外，**句子翻译内部固定用 0.2 的低温**以保证译文稳定，不受此项影响。
- 其他选项：**助手回复语言**（AI 解释与对话的回复语言，默认中文，可改 English）；**翻译目标语言**（默认中文，可改日/韩/法/德/西）。
- **解释提示词（可选）**：自定义"解释一句话"时发给模型的指令模板。占位符 `{TEXT}` = 选中的句子原文，`{CONTEXT}` = 所在段落。留空则使用内置提示词。例如想让解释更简短：`用中文简明解释下面这句英文的意思和难点，不超过三句话：{TEXT}`。单词查词走独立的内置提示词，不受此项影响。
- **Tavily API 密钥（可选）**：给 🔍 联网搜索用的 Key。**本机若装有 Tavily CLI（`~/.tavily/config.json`）会自动探测、无需填写**；没填也没关系，自动降级为免 Key 的必应网页搜索。

## 使用方法

1. **打开书籍**：点 `📖 Open Book` 或直接把 `.txt` / `.md` / `.epub` 文件拖进窗口。首次可点 `Read the sample` 试用（内置《爱丽丝梦游仙境》第一章选段）。
2. **翻译**：在句子上**右键 → Translate sentence**，该句会独立成行并加左侧橙色竖线，中文译文紧贴其下、竖线对齐，两行是一个视觉组——一眼可见译文对应哪句英文。鼠标悬停英文句或译文，整组会加深高亮；悬停译文点 ✕ 可删除；工具栏 `⇅` 隐藏全部译文时，已译句子恢复原位并带虚线下划线标记（再点显示）。
3. **解释**：右键 → `Explain`，解释内容进入右侧对话栏。被解释的英文原句以**深色卡片、白色文字**醒目展示（"EXPLAINING THIS"），一眼可见在解释哪句；**默认用中文解释**（设置里「助手回复语言」可改）。选中单个单词后 Explain 会按词典方式讲解（音标、词性、语境义、例句）。
4. **划选翻译**：按住鼠标选中任意片段后右键 → `Translate selection`。
5. **对话**：右侧输入框直接与模型讨论本书（Enter 发送，Shift+Enter 换行，生成中可 Stop）。AI 会自动带上书名和你正在读的段落作为上下文，默认以中文回复。
6. **联网搜索 🔍**：对话栏标题右侧的 🔍 按钮点亮后，模型可以调用 `web_search` 工具联网查资料再回答（作者生平、出版背景、文化典故等），对话中会显示 `🔍 web_search · 查询词` 的过程行。搜索通道自动选择：优先本机探测到的 Tavily Key（质量更好），否则免 Key 的必应网页搜索；相同查询 10 分钟内走缓存。
7. **章节**：工具栏 `☰` 打开章节目录（epub 按目录解析；txt 按 `CHAPTER` 等标题行自动分章）。
8. **外观**：`A− / A+` 调字号，`☀` 循环切换 羊皮纸/亮/暗 三主题，拖动中间分隔条可调对话栏宽度。

阅读进度、每句翻译、对话记录均按书自动保存在浏览器里，下次打开同一本书自动恢复。

## 文件结构

```
english-reader/
├── server.py            # 本地服务：静态页面 + LLM API 代理（纯标准库，零依赖）
├── static/
│   ├── index.html       # 界面（全英文）
│   ├── style.css        # 三主题样式
│   └── app.js           # 阅读器逻辑（句子切分/txt·epub 解析/右键菜单/流式对话）
└── tests/
    ├── mock_llm.py      # 本地假模型（无需真实 Key 即可测试）
    ├── make_test_epub.py# 生成测试用 epub
    ├── gui_test.cjs     # Playwright 黑盒 GUI 测试（15 项断言）
    └── gui-shots/       # 测试截图
```

## 分享与部署（GitHub / 压缩包）

项目已初始化为 git 仓库（不含测试截图等生成物，见 `.gitignore`），两种方式分享给别人：

**上传到 GitHub**（需本机装了 Git；命令在本目录执行）：

```
cd C:\Users\DELL\ZCodeProject\english-reader
git remote add origin https://github.com/<你的用户名>/english-reader.git
git push -u origin main
```

（先在 GitHub 网页上新建一个名为 `english-reader` 的空仓库；或装了 GitHub CLI 时直接 `gh repo create english-reader --public --source . --push`。）

**打包压缩包**：桌面上的 `English-Reader-v1.zip` 即完整项目包（已排除 `.git`、测试截图与缓存）。发给别人后，对方解压，双击 `Start-English-Reader.bat` 即可（或命令行执行 `python server.py`），浏览器自动打开 `http://127.0.0.1:8765`。唯一依赖是 Python 3.8+，无需 pip 安装任何包。

## 常见问题

- **为什么经过本地代理？** 浏览器直连各家 API 会有跨域（CORS）限制，`server.py` 在本机转发请求，任何厂商都能接，也顺带避免页面暴露 Key。
- **PDF 书？** 暂不支持，请先转成 txt（本项目里已有 pdfjs 等工具可转）。
- **txt 打开是乱码？** 程序按 UTF-8 → Windows-1252 顺序自动尝试，个别 GBK 编码文件建议先另存为 UTF-8。
- **测试**：`python tests/mock_llm.py` 后，在 Settings 里填 Base URL `http://127.0.0.1:8766/v1`、模型 `mock-gpt`（Key 随意），即可无 Key 体验全部功能；`node tests/gui_test.cjs` 跑自动化回归（需先启动 reader 与 mock 两个服务）。
