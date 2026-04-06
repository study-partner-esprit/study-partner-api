const express = require('express');
const Friendship = require('../models/Friendship');
const UserProfile = require('../models/UserProfile');
const Gamification = require('../models/Gamification');
const axios = require('axios');

const router = express.Router();

const NOTIFICATION_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:3007';

// Helper: send notification
async function notify(userId, type, title, message, metadata, authHeader) {
  try {
    await axios.post(
      `${NOTIFICATION_URL}/api/v1/notifications`,
      {
        userId,
        type,
        title,
        message,
        metadata
      },
      { headers: { Authorization: authHeader } }
    );
  } catch (err) {
    console.warn('Notification send failed:', err.message);
  }
}

// GET / — List accepted friends
router.get('/', async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;

    const friendships = await Friendship.find({
      $or: [{ requester: userId }, { recipient: userId }],
      status: 'accepted'
    })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean();

    const friendIds = friendships.map((f) => (f.requester === userId ? f.recipient : f.requester));
    const profiles = await UserProfile.find({ userId: { $in: friendIds } }).lean();
    const profileMap = {};
    profiles.forEach((p) => {
      profileMap[p.userId] = p;
    });

    // Fetch actual levels from Gamification collection
    const gamDocs = await Gamification.find({ userId: { $in: friendIds } })
      .select('userId level')
      .lean();
    const levelMap = {};
    gamDocs.forEach((g) => {
      levelMap[g.userId] = g.level;
    });

    const friends = friendships.map((f) => {
      const friendId = f.requester === userId ? f.recipient : f.requester;
      const profile = profileMap[friendId] || {};
      return {
        friendshipId: f._id,
        userId: friendId,
        name: profile.nickname || 'User',
        avatar: profile.avatar,
        level: levelMap[friendId] || 1,
        onlineStatus: profile.privacy?.showOnlineStatus !== false ? profile.onlineStatus : 'hidden',
        friendSince: f.updatedAt
      };
    });

    res.json({ friends, page, limit });
  } catch (error) {
    console.error('Error fetching friends:', error);
    res.status(500).json({ error: 'Failed to fetch friends' });
  }
});

// GET /requests/incoming — Pending received
router.get('/requests/incoming', async (req, res) => {
  try {
    const requests = await Friendship.find({ recipient: req.user.userId, status: 'pending' })
      .sort({ createdAt: -1 })
      .lean();

    const userIds = requests.map((r) => r.requester);
    const profiles = await UserProfile.find({ userId: { $in: userIds } }).lean();
    const profileMap = {};
    profiles.forEach((p) => {
      profileMap[p.userId] = p;
    });

    const gamDocs = await Gamification.find({ userId: { $in: userIds } })
      .select('userId level')
      .lean();
    const levelMap = {};
    gamDocs.forEach((g) => {
      levelMap[g.userId] = g.level;
    });

    const result = requests.map((r) => ({
      friendshipId: r._id,
      userId: r.requester,
      name: profileMap[r.requester]?.nickname || 'User',
      avatar: profileMap[r.requester]?.avatar,
      level: levelMap[r.requester] || 1,
      sentAt: r.createdAt
    }));

    res.json({ requests: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// GET /requests/outgoing — Pending sent
router.get('/requests/outgoing', async (req, res) => {
  try {
    const requests = await Friendship.find({ requester: req.user.userId, status: 'pending' })
      .sort({ createdAt: -1 })
      .lean();

    const userIds = requests.map((r) => r.recipient);
    const profiles = await UserProfile.find({ userId: { $in: userIds } }).lean();
    const profileMap = {};
    profiles.forEach((p) => {
      profileMap[p.userId] = p;
    });

    const gamDocs = await Gamification.find({ userId: { $in: userIds } })
      .select('userId level')
      .lean();
    const levelMap = {};
    gamDocs.forEach((g) => {
      levelMap[g.userId] = g.level;
    });

    const result = requests.map((r) => ({
      friendshipId: r._id,
      userId: r.recipient,
      name: profileMap[r.recipient]?.nickname || 'User',
      avatar: profileMap[r.recipient]?.avatar,
      level: levelMap[r.recipient] || 1,
      sentAt: r.createdAt
    }));

    res.json({ requests: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch requests' });
  }
});

// POST /request — Send friend request
router.post('/request', async (req, res) => {
  try {
    const requesterId = req.user.userId;
    const { userId: targetUserId, friendCode } = req.body;

    let recipientId = targetUserId;

    // Resolve friend code to userId
    if (!recipientId && friendCode) {
      const profile = await UserProfile.findOne({ friendCode: friendCode.toUpperCase() });
      if (!profile) return res.status(404).json({ error: 'Friend code not found' });
      recipientId = profile.userId;
    }

    if (!recipientId) return res.status(400).json({ error: 'userId or friendCode required' });
    if (recipientId === requesterId)
      return res.status(400).json({ error: 'Cannot friend yourself' });

    // Check if blocked
    const blocked = await Friendship.findOne({
      $or: [
        { requester: recipientId, recipient: requesterId, status: 'blocked' },
        { requester: requesterId, recipient: recipientId, status: 'blocked' }
      ]
    });
    if (blocked) return res.status(403).json({ error: 'Cannot send request to this user' });

    // Check recipient privacy
    const recipientProfile = await UserProfile.findOne({ userId: recipientId });
    if (recipientProfile?.privacy?.allowRequests === 'nobody') {
      return res.status(403).json({ error: 'This user does not accept friend requests' });
    }

    // Check existing relationship
    const existing = await Friendship.findOne({
      $or: [
        { requester: requesterId, recipient: recipientId },
        { requester: recipientId, recipient: requesterId }
      ]
    });

    if (existing) {
      if (existing.status === 'accepted') return res.status(409).json({ error: 'Already friends' });
      if (existing.status === 'pending')
        return res.status(409).json({ error: 'Request already pending' });
      if (existing.status === 'rejected') {
        // 7-day cooldown after rejection
        const cooldownEnd = new Date(existing.updatedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        if (new Date() < cooldownEnd) {
          return res.status(429).json({ error: 'Please wait before sending another request' });
        }
        // Allow re-request after cooldown
        existing.status = 'pending';
        existing.requester = requesterId;
        existing.recipient = recipientId;
        await existing.save();
        await notify(
          recipientId,
          'friend_request',
          'New Friend Request',
          `Someone wants to be your friend!`,
          { friendshipId: existing._id },
          req.headers.authorization
        );
        return res.json({ message: 'Friend request sent', friendship: existing });
      }
    }

    const friendship = await Friendship.create({ requester: requesterId, recipient: recipientId });

    // Send notification
    await notify(
      recipientId,
      'friend_request',
      'New Friend Request',
      `Someone wants to be your friend!`,
      { friendshipId: friendship._id },
      req.headers.authorization
    );

    res.status(201).json({ message: 'Friend request sent', friendship });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'Request already exists' });
    console.error('Error sending request:', error);
    res.status(500).json({ error: 'Failed to send friend request' });
  }
});

// PUT /request/:friendshipId/accept
router.put('/request/:friendshipId/accept', async (req, res) => {
  try {
    const friendship = await Friendship.findOne({
      _id: req.params.friendshipId,
      recipient: req.user.userId,
      status: 'pending'
    });

    if (!friendship) return res.status(404).json({ error: 'Request not found' });

    friendship.status = 'accepted';
    await friendship.save();

    // Notify requester
    await notify(
      friendship.requester,
      'friend_accepted',
      'Friend Request Accepted',
      'Your friend request was accepted!',
      { friendshipId: friendship._id },
      req.headers.authorization
    );

    // Award XP
    try {
      const USER_PROFILE_URL =
        process.env.USER_PROFILE_SERVICE_URL || 'http://user-profile-service:3002';
      for (const _uid of [friendship.requester, friendship.recipient]) {
        await axios.post(
          `${USER_PROFILE_URL}/api/v1/users/gamification/award-xp`,
          {
            action: 'friend_added',
            metadata: { friendshipId: friendship._id.toString() }
          },
          { headers: { Authorization: req.headers.authorization } }
        );
      }
    } catch (xpErr) {
      console.warn('Friend XP award failed:', xpErr.message);
    }

    res.json({ message: 'Friend request accepted', friendship });
  } catch (error) {
    res.status(500).json({ error: 'Failed to accept request' });
  }
});

// PUT /request/:friendshipId/reject
router.put('/request/:friendshipId/reject', async (req, res) => {
  try {
    const friendship = await Friendship.findOne({
      _id: req.params.friendshipId,
      recipient: req.user.userId,
      status: 'pending'
    });

    if (!friendship) return res.status(404).json({ error: 'Request not found' });

    friendship.status = 'rejected';
    await friendship.save();

    res.json({ message: 'Friend request rejected' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

// DELETE /request/:friendshipId — Cancel outgoing
router.delete('/request/:friendshipId', async (req, res) => {
  try {
    const result = await Friendship.findOneAndDelete({
      _id: req.params.friendshipId,
      requester: req.user.userId,
      status: 'pending'
    });

    if (!result) return res.status(404).json({ error: 'Request not found' });
    res.json({ message: 'Request cancelled' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel request' });
  }
});

// DELETE /:friendId — Unfriend
router.delete('/:friendId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const friendId = req.params.friendId;

    const result = await Friendship.findOneAndDelete({
      $or: [
        { requester: userId, recipient: friendId, status: 'accepted' },
        { requester: friendId, recipient: userId, status: 'accepted' }
      ]
    });

    if (!result) return res.status(404).json({ error: 'Friendship not found' });
    res.json({ message: 'Friend removed' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove friend' });
  }
});

// POST /block/:userId
router.post('/block/:userId', async (req, res) => {
  try {
    const userId = req.user.userId;
    const blockId = req.params.userId;

    // Remove existing friendship if any
    await Friendship.findOneAndDelete({
      $or: [
        { requester: userId, recipient: blockId },
        { requester: blockId, recipient: userId }
      ]
    });

    await Friendship.create({ requester: userId, recipient: blockId, status: 'blocked' });
    res.json({ message: 'User blocked' });
  } catch (error) {
    if (error.code === 11000) return res.json({ message: 'Already blocked' });
    res.status(500).json({ error: 'Failed to block user' });
  }
});

// DELETE /block/:userId
router.delete('/block/:userId', async (req, res) => {
  try {
    await Friendship.findOneAndDelete({
      requester: req.user.userId,
      recipient: req.params.userId,
      status: 'blocked'
    });
    res.json({ message: 'User unblocked' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to unblock' });
  }
});

// GET /blocked
router.get('/blocked', async (req, res) => {
  try {
    const blocked = await Friendship.find({ requester: req.user.userId, status: 'blocked' }).lean();
    const userIds = blocked.map((b) => b.recipient);
    const profiles = await UserProfile.find({ userId: { $in: userIds } }).lean();

    res.json({
      blocked: profiles.map((p) => ({
        userId: p.userId,
        name: p.nickname || 'User',
        avatar: p.avatar
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch blocked users' });
  }
});

// GET /search — Search users
router.get('/search', async (req, res) => {
  try {
    const userId = req.user.userId;
    const q = req.query.q || '';
    if (q.length < 2) return res.json({ results: [] });

    // Get blocked users to exclude
    const blockedDocs = await Friendship.find({
      $or: [
        { requester: userId, status: 'blocked' },
        { recipient: userId, status: 'blocked' }
      ]
    }).lean();
    const blockedIds = blockedDocs.map((b) => (b.requester === userId ? b.recipient : b.requester));
    blockedIds.push(userId); // exclude self

    const query = {
      userId: { $nin: blockedIds },
      $or: [{ nickname: { $regex: q, $options: 'i' } }, { friendCode: q.toUpperCase() }]
    };

    const profiles = await UserProfile.find(query).limit(20).lean();

    // Check friendship status for each result
    const resultUserIds = profiles.map((p) => p.userId);
    const friendships = await Friendship.find({
      $or: resultUserIds.flatMap((fid) => [
        { requester: userId, recipient: fid },
        { requester: fid, recipient: userId }
      ])
    }).lean();

    const friendshipMap = {};
    friendships.forEach((f) => {
      const otherId = f.requester === userId ? f.recipient : f.requester;
      friendshipMap[otherId] = f.status;
    });

    // Batch-fetch Gamification levels for search results
    const searchGamDocs = await Gamification.find({ userId: { $in: resultUserIds } })
      .select('userId level')
      .lean();
    const searchLevelMap = {};
    searchGamDocs.forEach((g) => {
      searchLevelMap[g.userId] = g.level;
    });

    res.json({
      results: profiles.map((p) => ({
        userId: p.userId,
        name: p.nickname || 'User',
        avatar: p.avatar,
        level: searchLevelMap[p.userId] || 1,
        friendCode: p.friendCode,
        friendshipStatus: friendshipMap[p.userId] || null
      }))
    });
  } catch (error) {
    console.error('Error searching users:', error);
    res.status(500).json({ error: 'Failed to search users' });
  }
});

// GET /:friendId/profile — View friend profile
router.get('/:friendId/profile', async (req, res) => {
  try {
    const userId = req.user.userId;
    const friendId = req.params.friendId;

    // Verify friendship
    const friendship = await Friendship.findOne({
      $or: [
        { requester: userId, recipient: friendId, status: 'accepted' },
        { requester: friendId, recipient: userId, status: 'accepted' }
      ]
    });

    const profile = await UserProfile.findOne({ userId: friendId }).lean();
    if (!profile) return res.status(404).json({ error: 'Profile not found' });

    // Get actual level from Gamification
    const gam = await Gamification.findOne({ userId: friendId }).select('level').lean();

    const isFriend = !!friendship;
    const result = {
      userId: profile.userId,
      name: profile.nickname || 'User',
      avatar: profile.avatar,
      level: gam?.level || 1,
      bio: profile.bio,
      friendCode: profile.friendCode,
      onlineStatus: profile.privacy?.showOnlineStatus !== false ? profile.onlineStatus : 'hidden',
      isFriend
    };

    // Include stats only if friend and privacy allows
    if (isFriend && profile.privacy?.showStats !== false) {
      result.stats = profile.stats;
    }

    res.json({ profile: result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// GET /online — Online friends
router.get('/online', async (req, res) => {
  try {
    const userId = req.user.userId;
    const friendships = await Friendship.find({
      $or: [{ requester: userId }, { recipient: userId }],
      status: 'accepted'
    }).lean();

    const friendIds = friendships.map((f) => (f.requester === userId ? f.recipient : f.requester));
    const onlineProfiles = await UserProfile.find({
      userId: { $in: friendIds },
      onlineStatus: { $ne: 'offline' },
      'privacy.showOnlineStatus': { $ne: false }
    }).lean();

    res.json({
      online: onlineProfiles.map((p) => {
        // Note: for /online we skip extra Gamification lookup to keep it fast
        return {
          userId: p.userId,
          name: p.nickname || 'User',
          avatar: p.avatar,
          level: p.level?.current || 1,
          onlineStatus: p.onlineStatus
        };
      })
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch online friends' });
  }
});

// GET /count — Friend counts
router.get('/count', async (req, res) => {
  try {
    const userId = req.user.userId;
    const total = await Friendship.countDocuments({
      $or: [{ requester: userId }, { recipient: userId }],
      status: 'accepted'
    });
    const pending = await Friendship.countDocuments({
      recipient: userId,
      status: 'pending'
    });

    // Online count
    const friendships = await Friendship.find({
      $or: [{ requester: userId }, { recipient: userId }],
      status: 'accepted'
    }).lean();
    const friendIds = friendships.map((f) => (f.requester === userId ? f.recipient : f.requester));
    const online = await UserProfile.countDocuments({
      userId: { $in: friendIds },
      onlineStatus: { $ne: 'offline' }
    });

    res.json({ total, online, pending });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get count' });
  }
});

module.exports = router;
