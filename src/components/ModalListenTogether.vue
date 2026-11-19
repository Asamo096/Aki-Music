<template>
  <Modal
    class="listen-together-modal"
    :show="show"
    :close="close"
    :show-footer="false"
    :title="$t('listenTogether.title')"
    width="440px"
  >
    <template slot="default">
      <!-- 未在房间：创建 / 加入 -->
      <div v-if="!inRoom" class="panel">
        <div class="tabs">
          <span :class="{ active: tab === 'create' }" @click="tab = 'create'">
            {{ $t('listenTogether.createRoom') }}
          </span>
          <span :class="{ active: tab === 'join' }" @click="tab = 'join'">
            {{ $t('listenTogether.joinRoom') }}
          </span>
        </div>

        <div v-if="tab === 'create'" class="tab-content">
          <p class="desc">{{ $t('listenTogether.createDesc') }}</p>
          <button
            class="primary-btn"
            :disabled="listenTogether.syncing"
            @click="createRoom"
          >
            {{
              listenTogether.syncing
                ? $t('listenTogether.creating')
                : $t('listenTogether.createRoom')
            }}
          </button>
        </div>

        <div v-else class="tab-content">
          <p class="desc">{{ $t('listenTogether.joinDesc') }}</p>
          <input
            v-model="joinInput"
            class="text-input"
            :placeholder="$t('listenTogether.joinPlaceholder')"
            @keyup.enter="joinRoom"
          />
          <button
            class="primary-btn"
            :disabled="listenTogether.syncing || !joinInput.trim()"
            @click="joinRoom"
          >
            {{ $t('listenTogether.joinRoom') }}
          </button>
        </div>

        <p v-if="listenTogether.lastError" class="error">
          {{ listenTogether.lastError }}
        </p>
      </div>

      <!-- 在房间 -->
      <div v-else class="panel room">
        <div class="room-header">
          <div class="room-status">
            <span class="badge" :class="isOwner ? 'owner' : 'member'">
              {{
                isOwner
                  ? $t('listenTogether.owner')
                  : $t('listenTogether.member')
              }}
            </span>
            <span class="room-id">#{{ listenTogether.roomId }}</span>
          </div>
          <button class="link-btn" @click="copyShareLink">
            {{ $t('listenTogether.copyLink') }}
          </button>
        </div>

        <div class="members">
          <div class="members-title">
            {{ $t('listenTogether.members', { count: members.length }) }}
          </div>
          <div
            v-for="member in members"
            :key="String(member.userId)"
            class="member"
          >
            <img :src="member.avatarUrl" class="avatar" loading="lazy" />
            <span class="nick">{{ member.nickname }}</span>
            <span
              v-if="String(member.userId) === String(listenTogether.creatorId)"
              class="owner-tag"
              >{{ $t('listenTogether.owner') }}</span
            >
          </div>
        </div>

        <div class="current-song">
          <div class="section-title">{{ $t('listenTogether.nowPlaying') }}</div>
          <div v-if="currentSong" class="song-row">
            <img
              v-if="currentSong.al && currentSong.al.picUrl"
              :src="`${currentSong.al.picUrl}?param=64y64`"
              class="cover"
              loading="lazy"
            />
            <div class="song-meta">
              <div class="name">{{ currentSong.name }}</div>
              <div class="artist">
                {{ (currentSong.ar || []).map(a => a.name).join(' / ') }}
              </div>
            </div>
            <span class="play-status">
              {{
                roomPlaying
                  ? $t('listenTogether.playing')
                  : $t('listenTogether.paused')
              }}
            </span>
          </div>
          <p v-else class="desc">{{ $t('listenTogether.noSong') }}</p>
        </div>

        <div class="follow-row">
          <span>{{ $t('listenTogether.followOwner') }}</span>
          <div class="toggle">
            <input
              id="lt-follow"
              type="checkbox"
              :checked="listenTogether.followRoomPlayback"
              @change="toggleFollow"
            />
            <label for="lt-follow"></label>
          </div>
        </div>

        <p class="hint">{{ $t('listenTogether.followHint') }}</p>

        <button class="leave-btn" @click="leaveRoom">
          {{ $t('listenTogether.leaveRoom') }}
        </button>
      </div>
    </template>
  </Modal>
</template>

<script>
/**
 * 双人「一起听」面板（M4）。
 *
 * 数据来自 store.listenTogether（由 utils/listenTogether.js 的 service 维护），
 * 面板只负责创建 / 加入 / 展示成员与当前播放 / 复制分享链接 / 退出。
 * 多人房 UI 已按计划书 §10 删除。
 */
import { mapState } from 'vuex';
import Modal from '@/components/Modal.vue';
import listenTogetherService from '@/utils/listenTogether';
import { copyLyric as copyText } from '@/utils/lyrics';

export default {
  name: 'ModalListenTogether',
  components: { Modal },
  data() {
    return {
      tab: 'create',
      joinInput: '',
    };
  },
  computed: {
    ...mapState(['listenTogether', 'modals', 'player']),
    show() {
      return this.modals.listenTogetherModal.show;
    },
    inRoom() {
      return this.listenTogether.inRoom;
    },
    isOwner() {
      return String(this.listenTogether.creatorId) === String(this.userId);
    },
    userId() {
      return this.$store.state.data?.user?.userId ?? 0;
    },
    members() {
      return this.listenTogether.roomMembers || [];
    },
    currentSong() {
      const cmd = this.listenTogether.roomPlayCommand;
      if (!cmd) return null;
      return (
        this.listenTogether.roomPlaylistTracks?.find(
          track => String(track.id) === String(cmd.targetSongId)
        ) || { id: cmd.targetSongId, name: `#${cmd.targetSongId}`, ar: [] }
      );
    },
    roomPlaying() {
      return this.listenTogether.roomPlayCommand?.playStatus === 'PLAY';
    },
  },
  methods: {
    close() {
      this.$store.commit('updateModal', {
        modalName: 'listenTogetherModal',
        key: 'show',
        value: false,
      });
    },
    async createRoom() {
      const result = await listenTogetherService.createRoom();
      if (result.ok) this.tab = 'create';
    },
    async joinRoom() {
      const result = await listenTogetherService.joinRoom(
        this.joinInput.trim()
      );
      if (result.ok) this.joinInput = '';
    },
    async leaveRoom() {
      await listenTogetherService.leaveRoom();
      this.close();
    },
    toggleFollow() {
      listenTogetherService.toggleFollowRoomPlayback();
    },
    copyShareLink() {
      if (!this.listenTogether.shareLink) return;
      copyText(this.listenTogether.shareLink);
      this.$store.dispatch('showToast', this.$t('listenTogether.linkCopied'));
    },
  },
};
</script>

<style lang="scss" scoped>
.listen-together-modal {
  .panel {
    color: var(--color-text);
  }

  .tabs {
    display: flex;
    gap: 18px;
    margin-bottom: 14px;
    border-bottom: 1px solid var(--color-shape-color);

    span {
      padding: 6px 2px 10px;
      font-size: 15px;
      cursor: pointer;
      opacity: 0.55;
      border-bottom: 2px solid transparent;
      transition: 0.2s;

      &.active {
        opacity: 1;
        border-bottom-color: var(--color-primary);
      }
    }
  }

  .tab-content {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .desc {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    opacity: 0.65;
  }

  .text-input {
    padding: 9px 12px;
    border: none;
    border-radius: 8px;
    font-size: 13px;
    font-family: inherit;
    color: var(--color-text);
    background: var(--color-secondary-bg-for-transparent);
    outline: none;
  }

  .primary-btn,
  .leave-btn {
    padding: 9px 14px;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-family: inherit;
    cursor: pointer;
    transition: 0.2s;
  }

  .primary-btn {
    color: #fff;
    background: var(--color-primary);

    &:disabled {
      opacity: 0.5;
      cursor: default;
    }
  }

  .leave-btn {
    margin-top: 14px;
    width: 100%;
    color: var(--color-text);
    background: var(--color-secondary-bg-for-transparent);

    &:hover {
      background: var(--color-shape-color);
    }
  }

  .error {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--color-red, #d33);
  }

  /* ── 房间 ── */
  .room-header {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .room-status {
      display: flex;
      align-items: center;
      gap: 8px;

      .badge {
        padding: 2px 8px;
        border-radius: 6px;
        font-size: 12px;

        &.owner {
          color: #fff;
          background: var(--color-primary);
        }

        &.member {
          background: var(--color-secondary-bg-for-transparent);
          opacity: 0.85;
        }
      }

      .room-id {
        font-size: 12px;
        opacity: 0.5;
      }
    }

    .link-btn {
      padding: 4px 10px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-family: inherit;
      color: var(--color-text);
      cursor: pointer;
      background: var(--color-secondary-bg-for-transparent);
    }
  }

  .members {
    margin-top: 14px;

    .members-title,
    .section-title {
      margin-bottom: 8px;
      font-size: 12px;
      font-weight: 600;
      opacity: 0.6;
    }

    .member {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;

      .avatar {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        object-fit: cover;
      }

      .nick {
        font-size: 13px;
      }

      .owner-tag {
        margin-left: auto;
        font-size: 11px;
        opacity: 0.5;
      }
    }
  }

  .current-song {
    margin-top: 16px;

    .song-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px;
      border-radius: 8px;
      background: var(--color-secondary-bg-for-transparent);

      .cover {
        width: 36px;
        height: 36px;
        border-radius: 6px;
        object-fit: cover;
      }

      .song-meta {
        min-width: 0;
        flex: 1;

        .name,
        .artist {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .name {
          font-size: 13px;
          font-weight: 600;
        }

        .artist {
          font-size: 11px;
          opacity: 0.6;
        }
      }

      .play-status {
        font-size: 11px;
        opacity: 0.55;
      }
    }
  }

  .follow-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 16px;
    font-size: 13px;
  }

  .hint {
    margin: 6px 0 0;
    font-size: 11px;
    opacity: 0.45;
  }
}
</style>
