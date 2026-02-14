using System.Text.Json;
using System.Text.Json.Serialization;
using CodeWalker.GameFiles;

namespace CodeWalkerService;

public class Request
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("type")]
    public string Type { get; set; } = "";

    [JsonPropertyName("xmlPath")]
    public string? XmlPath { get; set; }

    [JsonPropertyName("inputFolder")]
    public string? InputFolder { get; set; }

    [JsonPropertyName("outputPath")]
    public string? OutputPath { get; set; }
}

public class Response
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = "";

    [JsonPropertyName("success")]
    public bool Success { get; set; }

    [JsonPropertyName("outputPath")]
    public string? OutputPath { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }
}

class Program
{
    static void Main(string[] args)
    {
        // Disable console output buffering
        Console.OutputEncoding = System.Text.Encoding.UTF8;

        string? line;
        while ((line = Console.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            Response response;
            try
            {
                var request = JsonSerializer.Deserialize<Request>(line);
                if (request == null)
                {
                    continue;
                }

                response = ProcessRequest(request);
            }
            catch (Exception ex)
            {
                response = new Response
                {
                    Id = "unknown",
                    Success = false,
                    Error = ex.Message
                };
            }

            var json = JsonSerializer.Serialize(response);
            Console.WriteLine(json);
            Console.Out.Flush();
        }
    }

    static Response ProcessRequest(Request request)
    {
        try
        {
            switch (request.Type)
            {
                case "health":
                    return new Response { Id = request.Id, Success = true };

                case "convert_ydr":
                    return ConvertYdr(request);

                case "convert_ytd":
                    return ConvertYtd(request);

                case "convert_ybn":
                    return ConvertYbn(request);

                case "convert_ytyp":
                    return ConvertYtyp(request);

                default:
                    return new Response
                    {
                        Id = request.Id,
                        Success = false,
                        Error = $"Unknown command type: {request.Type}"
                    };
            }
        }
        catch (Exception ex)
        {
            return new Response
            {
                Id = request.Id,
                Success = false,
                Error = ex.ToString()
            };
        }
    }

    static Response ConvertYdr(Request request)
    {
        if (string.IsNullOrEmpty(request.XmlPath) || string.IsNullOrEmpty(request.OutputPath))
            throw new ArgumentException("xmlPath and outputPath are required");

        var xml = File.ReadAllText(request.XmlPath);
        var inputFolder = request.InputFolder ?? Path.GetDirectoryName(request.XmlPath) ?? ".";

        var ydr = XmlYdr.GetYdr(xml, inputFolder);
        var data = ydr.Save();
        File.WriteAllBytes(request.OutputPath, data);

        return new Response
        {
            Id = request.Id,
            Success = true,
            OutputPath = request.OutputPath
        };
    }

    static Response ConvertYtd(Request request)
    {
        if (string.IsNullOrEmpty(request.XmlPath) || string.IsNullOrEmpty(request.OutputPath))
            throw new ArgumentException("xmlPath and outputPath are required");

        var xml = File.ReadAllText(request.XmlPath);
        var inputFolder = request.InputFolder ?? Path.GetDirectoryName(request.XmlPath) ?? ".";

        var ytd = XmlYtd.GetYtd(xml, inputFolder);
        var data = ytd.Save();
        File.WriteAllBytes(request.OutputPath, data);

        return new Response
        {
            Id = request.Id,
            Success = true,
            OutputPath = request.OutputPath
        };
    }

    static Response ConvertYbn(Request request)
    {
        if (string.IsNullOrEmpty(request.XmlPath) || string.IsNullOrEmpty(request.OutputPath))
            throw new ArgumentException("xmlPath and outputPath are required");

        var xml = File.ReadAllText(request.XmlPath);

        var ybn = XmlYbn.GetYbn(xml);
        var data = ybn.Save();
        File.WriteAllBytes(request.OutputPath, data);

        return new Response
        {
            Id = request.Id,
            Success = true,
            OutputPath = request.OutputPath
        };
    }

    static Response ConvertYtyp(Request request)
    {
        if (string.IsNullOrEmpty(request.XmlPath) || string.IsNullOrEmpty(request.OutputPath))
            throw new ArgumentException("xmlPath and outputPath are required");

        var xml = File.ReadAllText(request.XmlPath);

        var ytyp = XmlYtyp.GetYtyp(xml);
        var data = ytyp.Save();
        File.WriteAllBytes(request.OutputPath, data);

        return new Response
        {
            Id = request.Id,
            Success = true,
            OutputPath = request.OutputPath
        };
    }
}
