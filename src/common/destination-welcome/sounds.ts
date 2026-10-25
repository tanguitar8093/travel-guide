import type { OsmDatasetId } from '../../geo/osm-datasets'
import okinawa from '../../../media/okiniwa-login.wav'
import taiwan from '../../../media/taiwan-login.mp3'
import japan from '../../../media/japan-login.mp3'

const sounds = { okinawa, taiwan, japan }
export function destinationWelcomeSound(dataset: OsmDatasetId = 'okinawa'): string {
  return sounds[dataset]
}
