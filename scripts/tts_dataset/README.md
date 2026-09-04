# CosyVoice 3 日语数据集工具

这组脚本把严格同名的 WAV 和日文转写整理为 CosyVoice 3 单说话人 SFT 数据集。
脚本不会修改原始文件。

## 输入约定

音频和文本使用相同的相对路径与文件名，仅扩展名不同：

```text
audio/scene-01/line-001.wav
text/scene-01/line-001.txt
```

文本使用 UTF-8，每个文件是一条音频的完整日文转写。缺少任意一侧时脚本会停止，避免
静默错配。

运行环境需要 Python 3.11+、FFmpeg 和 ffprobe。脚本没有第三方 Python 依赖。

## 1. 构建并审阅专有词典

仓库内置了一份命运石之门初始词典。先扫描转写并生成审阅材料：

```bash
python scripts/tts_dataset/build_lexicon.py \
  --text-dir /path/to/text \
  --output-dir /path/to/lexicon-review
```

输出包含：

- `lexicon.tsv`：可以直接编辑的有效词典；
- `lexicon_usage.tsv`：初始词典在语料中的命中次数；
- `lexicon_candidates.tsv`：包含拉丁字母、数字或中点的待确认词。

自动候选只能发现可疑写法，无法可靠猜测日语读音。请逐项听音频确认，尤其是人名、
缩写和数字。词典按最长表面形式一次替换，不会发生替换结果被再次替换的问题。

## 2. 清洗、转换和划分

审阅词典后运行：

```bash
python scripts/tts_dataset/prepare_dataset.py \
  --audio-dir /path/to/audio \
  --text-dir /path/to/text \
  --lexicon /path/to/lexicon-review/lexicon.tsv \
  --output-dir /path/to/amadeus-cosyvoice3 \
  --min-duration 1.0 \
  --max-duration 30.0 \
  --jobs 4
```

默认行为：

- 使用 ffprobe 统计输入格式和时长；
- 拒绝短于 1 秒、长于 30 秒、采样率低于 16kHz、空转写或损坏的样本；
- 使用 FFmpeg 转为 24kHz、单声道、16-bit PCM WAV；
- 使用固定随机种子按 90%/5%/5% 划分 train/dev/test；
- 相同规范化文本始终进入同一 split，避免重复台词泄漏；
- 应用专有词典，生成训练使用的 `text_tts`；
- 为单说话人统一写入 `amadeus` speaker ID，并在审计元数据中记录 `ja` language ID；
- 为每个 split 生成 `wav.scp`、`text`、`utt2spk`、`spk2utt` 和 `instruct`。

输出目录非空时默认拒绝执行。确认需要覆盖同名产物时显式增加 `--overwrite`。该选项不
删除旧目录中无关的文件；它会清理本轮样本对应的旧 WAV，避免筛选规则变化后留下失效
音频。正式数据集建议始终生成到一个新目录。

`--output-dir` 的路径不能包含空格，因为 CosyVoice 官方 `wav.scp` 解析器使用空白分隔
字段。

## 3. 检查输出

```text
amadeus-cosyvoice3/
├── audit.json
├── metadata.jsonl
├── rejected.jsonl
├── lexicon.tsv
├── lexicon_usage.tsv
├── lexicon_candidates.tsv
├── wav24k/
└── cosyvoice3/
    ├── train/
    ├── dev/
    └── test/
```

重点检查：

- `audit.json` 中的输入格式、总时长、拒绝原因和 split 时长；
- `rejected.jsonl` 中被筛掉的短句是否需要保留；
- `metadata.jsonl` 中 `text_original` 与 `text_tts` 的差异；
- `lexicon_candidates.tsv` 是否还有遗漏的专有词。

纯笑声、喘息和强音效片段建议继续留在 rejected 集，不要为了数量放回训练集。脚本不做
自动降噪、响度归一化或静音裁剪，避免对已经干净的角色语音造成不可逆伪影。

## 4. 生成 CosyVoice Parquet

在 CosyVoice 仓库和 Python 环境中，对三个 split 分别提取特征：

```bash
python tools/extract_embedding.py \
  --dir /path/to/amadeus-cosyvoice3/cosyvoice3/train \
  --onnx_path pretrained_models/Fun-CosyVoice3-0.5B/campplus.onnx

python tools/extract_speech_token.py \
  --dir /path/to/amadeus-cosyvoice3/cosyvoice3/train \
  --onnx_path pretrained_models/Fun-CosyVoice3-0.5B/speech_tokenizer_v3.onnx

mkdir -p /path/to/amadeus-cosyvoice3/cosyvoice3/train/parquet

python tools/make_parquet_list.py \
  --num_utts_per_parquet 500 \
  --num_processes 4 \
  --src_dir /path/to/amadeus-cosyvoice3/cosyvoice3/train \
  --des_dir /path/to/amadeus-cosyvoice3/cosyvoice3/train/parquet
```

dev 和 test 使用相同流程。单说话人 SFT 时，将 CosyVoice 3 配置里的
`padding.use_spk_embedding` 设为 `True`。

CosyVoice 当前内置文本前端主要处理中文和英文。推理日语时，应在 TTS 服务内应用同一
份词典和文本规范化，然后调用 `inference_sft(..., text_frontend=False)`。
