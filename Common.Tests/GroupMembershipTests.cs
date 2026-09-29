using System.Security.Claims;
using Autofills.Common;
using Xunit;

namespace Common.Tests;

// The "uploaders" group check (2026-09-29). UploaderService's authorisation
// handler defers to GroupMembership, so these pin down what counts as being in
// the group: the claim names Keycloak mappers emit, the with/without full-path
// spelling, and - just as important - what must NOT count.
public class GroupMembershipTests
{
    private static Claim[] Claims(params (string type, string value)[] pairs) =>
        pairs.Select(p => new Claim(p.type, p.value)).ToArray();

    [Fact]
    public void Member_when_the_groups_claim_names_the_group()
    {
        var claims = Claims(("groups", "uploaders"));
        Assert.True(GroupMembership.IsMember(claims, "uploaders"));
    }

    [Fact]
    public void Member_when_the_mapper_emits_full_group_paths()
    {
        var claims = Claims(("groups", "/uploaders"));
        Assert.True(GroupMembership.IsMember(claims, "uploaders"));
    }

    [Fact]
    public void Member_among_several_groups()
    {
        var claims = Claims(("groups", "viewers"), ("groups", "uploaders"), ("groups", "admins"));
        Assert.True(GroupMembership.IsMember(claims, "uploaders"));
    }

    [Fact]
    public void Member_when_the_older_kc_groups_claim_is_used()
    {
        var claims = Claims(("kc_groups", "uploaders"));
        Assert.True(GroupMembership.IsMember(claims, "uploaders"));
    }

    [Fact]
    public void Configured_group_name_may_itself_carry_a_slash_or_spaces()
    {
        var claims = Claims(("groups", "uploaders"));
        Assert.True(GroupMembership.IsMember(claims, " /uploaders "));
    }

    [Fact]
    public void Not_a_member_when_the_group_is_absent()
    {
        var claims = Claims(("groups", "viewers"));
        Assert.False(GroupMembership.IsMember(claims, "uploaders"));
    }

    [Fact]
    public void Not_a_member_when_there_is_no_groups_claim_at_all()
    {
        // The state of a token from a client with no Group Membership mapper.
        var claims = Claims(("preferred_username", "wanker"), ("sub", "abc"));
        Assert.False(GroupMembership.IsMember(claims, "uploaders"));
    }

    [Fact]
    public void Not_a_member_of_a_nested_group_with_the_same_leaf_name()
    {
        var claims = Claims(("groups", "/team/uploaders"));
        Assert.False(GroupMembership.IsMember(claims, "uploaders"));
    }

    [Fact]
    public void Group_names_are_case_sensitive_like_the_front_end_check()
    {
        var claims = Claims(("groups", "Uploaders"));
        Assert.False(GroupMembership.IsMember(claims, "uploaders"));
    }

    [Fact]
    public void A_similar_looking_role_claim_does_not_count()
    {
        var claims = Claims(("role", "uploaders"), ("roles", "uploaders"));
        Assert.False(GroupMembership.IsMember(claims, "uploaders"));
    }

    [Fact]
    public void An_empty_group_name_never_matches()
    {
        var claims = Claims(("groups", ""), ("groups", "/"));
        Assert.False(GroupMembership.IsMember(claims, ""));
        Assert.False(GroupMembership.IsMember(claims, "/"));
    }

    [Fact]
    public void GroupsOf_normalises_and_de_duplicates()
    {
        var claims = Claims(("groups", "/uploaders"), ("kc_groups", "uploaders"), ("groups", "viewers"), ("groups", ""));
        Assert.Equal(new[] { "uploaders", "viewers" }, GroupMembership.GroupsOf(claims));
    }
}
