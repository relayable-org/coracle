import type {Person} from 'src/util/types'
import type {Readable} from 'svelte/store'
import {pipe, assoc, whereEq, when, concat, reject, nth, map} from 'ramda'
import {synced} from 'src/util/misc'
import {derived} from 'svelte/store'
import database from 'src/agent/database'
import keys from 'src/agent/keys'
import cmd from 'src/agent/cmd'

// Create a special wrapper to manage profile data, follows, and relays in the same
// way whether the user is logged in or not. This involves creating a store that we
// allow an anonymous user to write to, then once the user logs in we use that until
// we have actual event data for them, which we then prefer. For extra fun, we also
// sync this stuff to regular private variables so we don't have to constantly call
// `get` on our stores.

let settingsCopy = null
let profileCopy = null
let petnamesCopy = []
let relaysCopy = []

const anonPetnames = synced('agent/user/anonPetnames', [])
const anonRelays = synced('agent/user/anonRelays', [])

const settings = synced("agent/user/settings", {
  relayLimit: 20,
  showMedia: true,
  reportAnalytics: true,
  dufflepudUrl: import.meta.env.VITE_DUFFLEPUD_URL,
})

const profile = derived(
  [keys.pubkey, database.people as Readable<any>],
  ([pubkey, $people]) => {
    if (!pubkey) {
      return null
    }

    return $people[pubkey] || {pubkey}
  }
) as Readable<Person>

const petnames = derived(
  [profile, anonPetnames],
  ([$profile, $anonPetnames]) =>
    $profile?.petnames || $anonPetnames
)

const relays = derived(
  [profile, anonRelays],
  ([$profile, $anonRelays]) =>
    $profile?.relays || $anonRelays
)

// Keep our copies up to date

settings.subscribe($settings => {
  settingsCopy = $settings
})

profile.subscribe($profile => {
  profileCopy = $profile
})

petnames.subscribe($petnames => {
  petnamesCopy = $petnames
})

relays.subscribe($relays => {
  relaysCopy = $relays
})

const user = {
  // Settings

  settings,
  getSettings: () => settingsCopy,
  getSetting: k => settingsCopy[k],
  dufflepud: path => `${settingsCopy.dufflepudUrl}${path}`,

  // Profile

  profile,
  getProfile: () => profileCopy,
  getPubkey: () => profileCopy?.pubkey,

  // Petnames

  petnames,
  getPetnames: () => petnamesCopy,
  petnamePubkeys: derived(petnames, map(nth(1))) as Readable<Array<string>>,
  updatePetnames(f) {
    const $petnames = f(petnamesCopy)

    anonPetnames.set($petnames)

    if (profileCopy) {
      cmd.setPetnames(relaysCopy, $petnames)
    }
  },
  addPetname(pubkey, url, name) {
    const tag = ["p", pubkey, url, name || ""]

    this.updatePetnames(pipe(reject(t => t[1] === pubkey), concat([tag])))
  },
  removePetname(pubkey) {
    this.updatePetnames(reject(t => t[1] === pubkey))
  },

  // Relays

  relays,
  getRelays: () => relaysCopy,
  updateRelays(f) {
    const $relays = f(relaysCopy)

    anonRelays.set($relays)

    if (profileCopy) {
      cmd.setRelays($relays, $relays)
    }
  },
  async addRelay(url) {
    this.updateRelays($relays => $relays.concat({url, write: true, read: true}))
  },
  async removeRelay(url) {
    this.updateRelays(reject(whereEq({url})))
  },
  async setRelayWriteCondition(url, write) {
    this.updateRelays(map(when(whereEq({url}), assoc('write', write))))
  },
}

export default user