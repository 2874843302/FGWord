import type { WordEntry } from '../types'

interface DetailPanelProps {
  word: WordEntry
  expanded: boolean
}

/** 把「英文：中文」形式的短语拆成可分别着色的两段 */
function splitPhrase(phrase: string): [string, string] {
  const m = phrase.match(/^(.+?)[：:]\s*(.+)$/)
  return m ? [m[1].trim(), m[2].trim()] : [phrase, '']
}

/** 例句按首个中文字符拆分英文原句与中文译文 */
function splitExample(example: string): [string, string] {
  const i = example.search(/[\u4e00-\u9fff]/)
  if (i <= 0) return [example, '']
  return [example.slice(0, i).trim(), example.slice(i).trim()]
}

/**
 * 悬停展开的详情面板：词性释义、短语、例句。
 * 面板与卡片同处于 .sheet 内，鼠标移入面板不会收起。
 */
export default function DetailPanel({ word, expanded }: DetailPanelProps) {
  const hasDetails =
    word.definitions.length > 0 || word.phrases.length > 0 || word.examples.length > 0

  return (
    <div className="detail" aria-hidden={!expanded}>
      {!hasDetails ? (
        <div className="detail-empty">
          暂无释义，可在词库中点击「补全」或「一键补全」。配置 AI 后也可补充未收录的词汇。
        </div>
      ) : (
        <>
          {word.definitions.length > 0 && (
            <section className="detail-block">
              <div className="detail-title">词性与释义</div>
              {word.definitions.map((d, i) => (
                <div className="detail-row" key={i}>
                  {d.partOfSpeech && <span className="pos">{d.partOfSpeech}</span>}
                  <span>{d.meaning}</span>
                </div>
              ))}
            </section>
          )}

          {word.phrases.length > 0 && (
            <section className="detail-block">
              <div className="detail-title">常用短语</div>
              {word.phrases.map((p, i) => {
                const [en, zh] = splitPhrase(p)
                return (
                  <div className="detail-row phrase-row" key={i}>
                    <span className="bullet" />
                    <span>
                      <span className="phrase-en">{en}</span>
                      {zh ? <span className="phrase-zh">：{zh}</span> : null}
                    </span>
                  </div>
                )
              })}
            </section>
          )}

          {word.examples.length > 0 && (
            <section className="detail-block">
              <div className="detail-title">例句</div>
              {word.examples.map((e, i) => {
                const [en, zh] = splitExample(e)
                return (
                  <div className="example" key={i}>
                    <span className="example-en">{en}</span>
                    <span className="example-zh">{zh || '中文翻译待补全'}</span>
                  </div>
                )
              })}
            </section>
          )}

          {word.phrases.length === 0 && word.examples.length === 0 && (
            <div className="detail-empty">可在词库中点击「补全」补充可用内容，配置 AI 后可继续补充双语短语与例句。</div>
          )}
        </>
      )}
      {word.lookupNote && <p className="lookup-note">{word.lookupNote}</p>}
      {!!word.sources?.length && (
        <div className="word-sources">
          <span>来源：</span>
          {word.sources.map((source, index) => (
            <span key={`${source.url}-${index}`}>
              {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a> : source.name}
              {source.license && <> · {source.license.url
                ? <a href={source.license.url} target="_blank" rel="noreferrer">{source.license.name}</a>
                : source.license.name}</>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
