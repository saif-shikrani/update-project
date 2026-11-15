import { mkdirSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { saveCallRecording } from './db.ts'

const recordingDirectory = 'data/call-recordings'
const maxRecordingBytes = 50 * 1024 * 1024

export async function downloadCallRecording(id: number, url: string, format: string | null) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Recording download returned ${response.status}.`)
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() || null
  const audio = Buffer.from(await response.arrayBuffer())
  if (audio.length > maxRecordingBytes) {
    throw new Error('The recording is larger than the 50 MB storage limit.')
  }
  if (!audio.length) throw new Error('The recording download was empty.')

  mkdirSync(recordingDirectory, { recursive: true })
  const extension = contentType === 'audio/wav' || format === 'wav' ? 'wav' : 'mp3'
  const path = join(recordingDirectory, `${id}.${extension}`)
  const temporaryPath = `${path}.tmp`
  writeFileSync(temporaryPath, audio)
  renameSync(temporaryPath, path)
  saveCallRecording(id, path, audio.length, contentType || `audio/${extension === 'wav' ? 'wav' : 'mpeg'}`)
  return { path, size: audio.length, contentType: contentType || `audio/${extension === 'wav' ? 'wav' : 'mpeg'}` }
}
