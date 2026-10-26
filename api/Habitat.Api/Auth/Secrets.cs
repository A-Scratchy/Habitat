using System.Security.Cryptography;
using System.Text;

namespace Habitat.Api.Auth;

/// <summary>Creates and hashes device tokens and pairing codes. Only hashes are ever stored.</summary>
public static class Secrets
{
    /// <summary>Recognisable prefix so leaked tokens are easy to spot (and to tell apart from Entra JWTs).</summary>
    public const string DeviceTokenPrefix = "hab_dev_";

    /// <summary>No 0/O or 1/I, so codes are easy to read aloud and type.</summary>
    private const string CodeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    private const int CodeLength = 8;

    public static string NewDeviceToken() =>
        DeviceTokenPrefix + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    /// <summary>e.g. "K7QP-M3XD": 32^8 ≈ 1.1 trillion possibilities.</summary>
    public static string NewPairingCode()
    {
        var code = RandomNumberGenerator.GetString(CodeAlphabet, CodeLength);
        return $"{code[..4]}-{code[4..]}";
    }

    /// <summary>Uppercases and strips spaces/dashes so "k7qp m3xd" matches "K7QP-M3XD".</summary>
    public static string NormalisePairingCode(string input) =>
        new(input.ToUpperInvariant().Where(char.IsAsciiLetterOrDigit).ToArray());

    public static string Hash(string value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
